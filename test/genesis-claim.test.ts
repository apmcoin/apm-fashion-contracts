import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import tokenomics from "../config/tokenomics.json";

const ROUND_COUNT = 36;
const E18 = 10n ** 18n;
const TOKEN_TOTAL = 10_000_000_000n * E18;
const GENESIS_ALLOCATION = BigInt(
  tokenomics.pools.find((pool) => pool.id === "genesis_allocation")!.amountTokens
) * E18;
const DAY = 24n * 60n * 60n;
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";

async function deployWithBalances(
  balances: bigint[],
  options: { allocation?: bigint; funded?: boolean } = {}
) {
  const [deployer, ...signers] = await ethers.getSigners();
  const values = balances.map((balance, i) => [signers[i].address, balance.toString()]);
  const tree = StandardMerkleTree.of(values, ["address", "uint256"]);
  const Token = await ethers.getContractFactory("ApmFashion");
  const token = await Token.deploy([deployer.address], [TOKEN_TOTAL]);
  await token.waitForDeployment();

  const start = BigInt(await time.latest()) + 100n;
  const roundEnds = Array.from(
    { length: ROUND_COUNT }, (_, round) => start + BigInt(round + 1) * 30n * DAY
  );
  const allocation = options.allocation ?? balances.reduce((sum, balance) => sum + balance * 2n, 0n);
  const Claim = await ethers.getContractFactory("GenesisClaim");
  const claim = await Claim.deploy(await token.getAddress(), tree.root, start, roundEnds, allocation);
  await claim.waitForDeployment();
  if (options.funded !== false) await token.transfer(await claim.getAddress(), allocation);

  const holders = balances.map((balance, i) => ({
    signer: signers[i],
    balance,
    proof: tree.getProof(i),
    monthly: balance * 2n / 36n,
  }));
  return { token, claim, tree, holders, start, roundEnds, allocation };
}

async function deployFixture() {
  // These balances produce both individual residues and a whole-pool residue.
  return deployWithBalances([GENESIS_ALLOCATION / 2n - 90n, 53n, 37n]);
}

async function unfundedFixture() {
  return deployWithBalances([1800n], { funded: false });
}

describe("GenesisClaim", () => {
  it("uses official address/balance proofs and permits one self-claim per round", async () => {
    const { token, claim, tree, holders, start, allocation } = await loadFixture(deployFixture);
    const holder = holders[0];
    expect(allocation).to.equal(GENESIS_ALLOCATION);
    expect(await claim.totalAllocation()).to.equal(allocation);
    expect(await claim.merkleRoot()).to.equal(tree.root);
    expect(await claim.CONVERSION_RATIO()).to.equal(2n);
    expect(await claim.ROUND_COUNT()).to.equal(36n);
    for (const name of ["owner", "withdraw", "leafHash", "roundAmount", "roundAllocations"]) {
      expect(claim.interface.getFunction(name)).to.equal(null);
    }

    await time.setNextBlockTimestamp(start);
    await expect(claim.connect(holder.signer).claim(holder.balance, holder.proof))
      .to.emit(claim, "Claimed")
      .withArgs(0n, holder.signer.address, holder.monthly);
    expect(await token.balanceOf(holder.signer.address)).to.equal(holder.monthly);
    expect(await claim.isClaimed(0n, holder.signer.address)).to.equal(true);
    await expect(claim.connect(holder.signer).claim(holder.balance, holder.proof))
      .to.be.revertedWithCustomError(claim, "AlreadyClaimed")
      .withArgs(0n, holder.signer.address);
  });

  it("rejects another caller, a changed balance and a changed proof without recording a claim", async () => {
    const { claim, holders, start } = await loadFixture(deployFixture);
    const holder = holders[0];
    await time.increaseTo(start);
    await expect(claim.claim(holder.balance, holder.proof))
      .to.be.revertedWithCustomError(claim, "InvalidProof");
    await expect(claim.connect(holder.signer).claim(holder.balance + 1n, holder.proof))
      .to.be.revertedWithCustomError(claim, "InvalidProof");
    await expect(claim.connect(holder.signer).claim(holder.balance, [ethers.ZeroHash]))
      .to.be.revertedWithCustomError(claim, "InvalidProof");
    expect(await claim.isClaimed(0n, holder.signer.address)).to.equal(false);
    expect(await claim.roundClaimed(0n)).to.equal(0n);
  });

  it("prevents multiple claims for a duplicate address even with different valid leaves", async () => {
    const { token, holders, start, roundEnds } = await loadFixture(deployFixture);
    const signer = holders[0].signer;
    const tree = StandardMerkleTree.of([
      [signer.address, "1800"], [signer.address, "3600"],
    ], ["address", "uint256"]);
    const Claim = await ethers.getContractFactory("GenesisClaim");
    const claim = await Claim.deploy(await token.getAddress(), tree.root, start, roundEnds, 10800n);
    await claim.waitForDeployment();
    await token.transfer(await claim.getAddress(), 10800n);
    await time.increaseTo(start);
    await claim.connect(signer).claim(1800n, tree.getProof(0));
    await expect(claim.connect(signer).claim(3600n, tree.getProof(1)))
      .to.be.revertedWithCustomError(claim, "AlreadyClaimed");
  });

  it("calculates the fixed monthly amount without overflowing multiplication", async () => {
    const { claim } = await loadFixture(deployFixture);
    const values = [0n, 1n, 17n, 18n, 19n, 35n, 36n, 53n, GENESIS_ALLOCATION, ethers.MaxUint256];
    for (const balance of values) {
      const amount = await claim.monthlyAmount(balance);
      expect(amount).to.equal(balance * 2n / 36n);
      const residue = balance * 2n - amount * 36n;
      expect(residue).to.be.gte(0n).and.lt(36n);
    }
  });

  for (const settlement of ["before claims", "after claims", "at final expiry"]) {
    it(`allows every holder all 36 claims with settlement ${settlement}`, async () => {
      const { token, claim, holders, start, roundEnds, allocation } = await loadFixture(deployFixture);
      const monthlyTotal = holders.reduce((sum, holder) => sum + holder.monthly, 0n);
      expect(monthlyTotal).to.be.lt(allocation / 36n);
      expect(allocation % 36n).not.to.equal(0n);

      for (let round = 0; round < ROUND_COUNT; round++) {
        await time.increaseTo(round === 0 ? start : roundEnds[round - 1]);
        if (settlement === "before claims") await claim.settleExpiredRounds();
        for (const holder of holders) {
          await expect(claim.connect(holder.signer).claim(holder.balance, holder.proof))
            .to.emit(claim, "Claimed")
            .withArgs(BigInt(round), holder.signer.address, holder.monthly);
        }
        if (settlement === "after claims") await claim.settleExpiredRounds();
        expect(await claim.roundClaimed(round)).to.equal(monthlyTotal);
      }

      await time.increaseTo(roundEnds[35]);
      await claim.settleExpiredRounds();
      for (const holder of holders) {
        expect(await token.balanceOf(holder.signer.address)).to.equal(holder.monthly * 36n);
      }
      expect(await token.balanceOf(DEAD_ADDRESS)).to.equal(allocation - monthlyTotal * 36n);
      expect(await token.balanceOf(await claim.getAddress())).to.equal(0n);
      expect(await claim.nextRoundToSettle()).to.equal(36n);
      await expect(claim.settleExpiredRounds()).not.to.emit(claim, "RoundSettled");
    });
  }

  it("conserves the pool with missed rounds and intermittent settlement", async () => {
    const { token, claim, holders, start, roundEnds, allocation } = await loadFixture(deployFixture);
    let paid = 0n;
    for (let round = 0; round < ROUND_COUNT; round++) {
      await time.increaseTo(round === 0 ? start : roundEnds[round - 1]);
      for (const [i, holder] of holders.entries()) {
        if ((round + i) % 3 !== 0) continue;
        await claim.connect(holder.signer).claim(holder.balance, holder.proof);
        paid += holder.monthly;
      }
      if (round % 5 === 0) await claim.settleExpiredRounds();
    }
    await time.increaseTo(roundEnds[35]);
    await claim.settleExpiredRounds();
    expect(await token.balanceOf(DEAD_ADDRESS)).to.equal(allocation - paid);
    expect(await token.balanceOf(await claim.getAddress())).to.equal(0n);
  });

  it("does not carry a missed round into the next claim", async () => {
    const { token, claim, holders, roundEnds, allocation } = await loadFixture(deployFixture);
    const holder = holders[0];
    await time.setNextBlockTimestamp(roundEnds[0]);
    await expect(claim.connect(holder.signer).claim(holder.balance, holder.proof))
      .to.emit(claim, "Claimed")
      .withArgs(1n, holder.signer.address, holder.monthly);
    expect(await token.balanceOf(holder.signer.address)).to.equal(holder.monthly);
    expect(await claim.isClaimed(0n, holder.signer.address)).to.equal(false);
    await expect(claim.settleExpiredRounds())
      .to.emit(claim, "RoundSettled")
      .withArgs(0n, allocation / 36n, 0n, allocation / 36n);
  });

  it("settles all 36 empty rounds including the final pool residue exactly once", async () => {
    const { token, claim, roundEnds, allocation } = await loadFixture(deployFixture);
    await expect(claim.settleExpiredRounds()).not.to.emit(claim, "RoundSettled");
    expect(await claim.nextRoundToSettle()).to.equal(0n);
    await time.increaseTo(roundEnds[35]);
    expect(await claim.settleExpiredRounds.staticCall()).to.deep.equal([36n, allocation]);
    const lastAllocation = allocation - allocation / 36n * 35n;
    await expect(claim.settleExpiredRounds())
      .to.emit(claim, "RoundSettled")
      .withArgs(35n, lastAllocation, 0n, lastAllocation);
    expect(await token.balanceOf(DEAD_ADDRESS)).to.equal(allocation);
    expect(await token.balanceOf(await claim.getAddress())).to.equal(0n);
    await expect(claim.settleExpiredRounds()).not.to.emit(claim, "RoundSettled");
  });

  it("handles completely claimed rounds without a zero-value token transfer", async () => {
    const { token, claim, holders, start, roundEnds, allocation } = await deployWithBalances([1800n]);
    await time.increaseTo(start);
    await claim.connect(holders[0].signer).claim(holders[0].balance, holders[0].proof);
    await time.increaseTo(roundEnds[0]);
    const settlement = claim.settleExpiredRounds();
    await expect(settlement).to.emit(claim, "RoundSettled")
      .withArgs(0n, allocation / 36n, allocation / 36n, 0n);
    await expect(settlement).not.to.emit(token, "Transfer");
    expect(await claim.nextRoundToSettle()).to.equal(1n);
  });

  it("closes claims before the start and at the exact final expiry", async () => {
    const { claim, holders, start, roundEnds } = await loadFixture(deployFixture);
    const holder = holders[0];
    await expect(claim.currentRound()).to.be.revertedWithCustomError(claim, "ClaimWindowClosed");
    await time.setNextBlockTimestamp(start - 1n);
    await expect(claim.connect(holder.signer).claim(holder.balance, holder.proof))
      .to.be.revertedWithCustomError(claim, "ClaimWindowClosed");
    await time.setNextBlockTimestamp(roundEnds[35] - 1n);
    await expect(claim.connect(holder.signer).claim(holder.balance, holder.proof))
      .to.emit(claim, "Claimed").withArgs(35n, holder.signer.address, holder.monthly);
    await time.setNextBlockTimestamp(roundEnds[35]);
    await expect(claim.connect(holder.signer).claim(holder.balance, holder.proof))
      .to.be.revertedWithCustomError(claim, "ClaimWindowClosed");
  });

  it("rejects a zero monthly claim without affecting other holders", async () => {
    const { claim, holders, start } = await deployWithBalances([17n, 18n]);
    await time.increaseTo(start);
    await expect(claim.connect(holders[0].signer).claim(holders[0].balance, holders[0].proof))
      .to.be.revertedWithCustomError(claim, "ZeroClaimAmount");
    expect(await claim.isClaimed(0n, holders[0].signer.address)).to.equal(false);
    await expect(claim.connect(holders[1].signer).claim(holders[1].balance, holders[1].proof))
      .to.emit(claim, "Claimed").withArgs(0n, holders[1].signer.address, 1n);
  });

  it("still rejects an inconsistent root whose claim exceeds the configured pool limit", async () => {
    const { claim, holders, start } = await deployWithBalances([1800n], { allocation: 36n });
    await time.increaseTo(start);
    await expect(claim.connect(holders[0].signer).claim(holders[0].balance, holders[0].proof))
      .to.be.revertedWithCustomError(claim, "RoundAllocationExceeded").withArgs(0n, 100n, 1n);
    expect(await claim.isClaimed(0n, holders[0].signer.address)).to.equal(false);
    expect(await claim.roundClaimed(0n)).to.equal(0n);
  });

  it("rolls back a failed claim and allows retry after funding within the same window", async () => {
    const { token, claim, holders, start, allocation } = await loadFixture(unfundedFixture);
    const holder = holders[0];
    await time.increaseTo(start);
    await expect(claim.connect(holder.signer).claim(holder.balance, holder.proof))
      .to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    expect(await claim.isClaimed(0n, holder.signer.address)).to.equal(false);
    expect(await claim.roundClaimed(0n)).to.equal(0n);
    await token.transfer(await claim.getAddress(), allocation);
    await expect(claim.connect(holder.signer).claim(holder.balance, holder.proof)).to.emit(claim, "Claimed");
  });

  it("rolls back failed settlement and allows retry without reopening expired claims", async () => {
    const { token, claim, holders, roundEnds, allocation } = await loadFixture(unfundedFixture);
    await time.increaseTo(roundEnds[35]);
    await expect(claim.settleExpiredRounds()).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    expect(await claim.nextRoundToSettle()).to.equal(0n);
    await token.transfer(await claim.getAddress(), allocation);
    await claim.settleExpiredRounds();
    expect(await token.balanceOf(DEAD_ADDRESS)).to.equal(allocation);
    expect(await claim.nextRoundToSettle()).to.equal(36n);
    await expect(claim.connect(holders[0].signer).claim(holders[0].balance, holders[0].proof))
      .to.be.revertedWithCustomError(claim, "ClaimWindowClosed");
  });

  it("validates token, root, allocation and all schedule intervals", async () => {
    const { token, tree, start, roundEnds, allocation } = await loadFixture(deployFixture);
    const Claim = await ethers.getContractFactory("GenesisClaim");
    const tokenAddress = await token.getAddress();
    await expect(Claim.deploy(ethers.ZeroAddress, tree.root, start, roundEnds, allocation))
      .to.be.revertedWithCustomError(Claim, "ZeroToken");
    await expect(Claim.deploy(tokenAddress, ethers.ZeroHash, start, roundEnds, allocation))
      .to.be.revertedWithCustomError(Claim, "ZeroMerkleRoot");
    await expect(Claim.deploy(tokenAddress, tree.root, start, roundEnds, 0n))
      .to.be.revertedWithCustomError(Claim, "ZeroAllocation");
    await expect(Claim.deploy(tokenAddress, tree.root, await time.latest(), roundEnds, allocation))
      .to.be.revertedWith("start in past");

    for (const round of [0, 1, 35]) {
      const previousEnd = round === 0 ? start : roundEnds[round - 1];
      for (const [interval, error] of [
        [28n * DAY - 1n, round === 0 ? "first interval too short" : "round interval too short"],
        [31n * DAY + 1n, round === 0 ? "first interval too long" : "round interval too long"],
        [0n, round === 0 ? "invalid first round end" : "round ends not increasing"],
      ] as const) {
        const invalidEnds = [...roundEnds];
        invalidEnds[round] = previousEnd + interval;
        await expect(Claim.deploy(tokenAddress, tree.root, start, invalidEnds, allocation))
          .to.be.revertedWith(error);
      }
    }

    let end = start;
    const validEnds = Array.from({ length: ROUND_COUNT }, (_, round) => {
      end += [28n, 29n, 30n, 31n][round % 4] * DAY;
      return end;
    });
    const valid = await Claim.deploy(tokenAddress, tree.root, start, validEnds, allocation);
    await valid.waitForDeployment();
    expect(await valid.startTimestamp()).to.equal(start);
    for (let round = 0; round < ROUND_COUNT; round++) {
      expect(await valid.roundEndTimestamps(round)).to.equal(validEnds[round]);
      await time.increaseTo(round === 0 ? start : validEnds[round - 1]);
      expect(await valid.currentRound()).to.equal(BigInt(round));
    }
  });
});
