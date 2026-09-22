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
  options: { allocation?: bigint; funded?: boolean; roundInterval?: bigint } = {}
) {
  const [deployer, ...signers] = await ethers.getSigners();
  const values = balances.map((balance, i) => [signers[i].address, balance.toString()]);
  const tree = StandardMerkleTree.of(values, ["address", "uint256"]);
  const Token = await ethers.getContractFactory("ApmFashion");
  const token = await Token.deploy([deployer.address], [TOKEN_TOTAL]);
  await token.waitForDeployment();

  const start = BigInt(await time.latest()) + 100n;
  const interval = options.roundInterval ?? 30n * DAY;
  const roundEnds = Array.from(
    { length: ROUND_COUNT }, (_, round) => start + BigInt(round + 1) * interval
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
    const publicInterface = new ethers.Interface(claim.interface.fragments);
    for (const name of ["owner", "withdraw", "leafHash", "roundAmount", "roundAllocations"]) {
      expect(publicInterface.getFunction(name)).to.equal(null);
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

  for (const claims of ["all", "some", "none"] as const) {
    it(`isolates unsolicited APM deposits over 36 short rounds when ${claims} holders claim`, async () => {
      const { token, claim, holders, start, roundEnds, allocation, tree } = await deployWithBalances(
        [1800n, 53n, 37n], { roundInterval: 300n }
      );
      const donor = (await ethers.getSigners())[19];
      const address = await claim.getAddress();
      await token.transfer(donor.address, TOKEN_TOTAL / 2n);
      const donate = async (amount: bigint) => token.connect(donor).transfer(address, amount);
      let donated = 1n;
      let paid = 0n;
      let settledBudget = 0n;
      let settledClaims = 0n;
      const received = holders.map(() => 0n);
      await donate(donated);

      for (let round = 0; round < ROUND_COUNT; round++) {
        const beforeClaims = round % 2 === 0 ? 1n : 1_000_000n * E18;
        const afterClaims = BigInt(round + 1);
        await time.setNextBlockTimestamp(round === 0 ? start : roundEnds[round - 1]);
        await donate(beforeClaims);
        donated += beforeClaims;
        expect(await claim.currentRound()).to.equal(BigInt(round));
        if (round % 2 === 0) await claim.connect(donor).settleExpiredRounds();

        let roundPaid = 0n;
        for (const [index, holder] of holders.entries()) {
          if (claims === "none" || (claims === "some" && (round + index) % 3 !== 0)) continue;
          await expect(claim.connect(holder.signer).claim(holder.balance, holder.proof))
            .to.emit(claim, "Claimed").withArgs(BigInt(round), holder.signer.address, holder.monthly);
          roundPaid += holder.monthly;
          received[index] += holder.monthly;
        }
        paid += roundPaid;
        await donate(afterClaims);
        donated += afterClaims;
        await claim.connect(donor).settleExpiredRounds();
        expect(await claim.roundClaimed(round)).to.equal(roundPaid);
        expect(await claim.nextRoundToSettle()).to.equal(BigInt(round));
        expect(await token.balanceOf(DEAD_ADDRESS)).to.equal(settledBudget - settledClaims);
        expect((await token.balanceOf(address)) + (await token.balanceOf(DEAD_ADDRESS)) + paid)
          .to.equal(allocation + donated);
        expect(await claim.totalAllocation()).to.equal(allocation);
        expect(await claim.merkleRoot()).to.equal(tree.root);
        settledBudget += round === 35 ? allocation - allocation / 36n * 35n : allocation / 36n;
        settledClaims += roundPaid;
      }

      await time.increaseTo(roundEnds[35]);
      await claim.connect(donor).settleExpiredRounds();
      expect(await token.balanceOf(DEAD_ADDRESS)).to.equal(allocation - paid);
      expect(await token.balanceOf(address)).to.equal(donated);
      expect(await claim.nextRoundToSettle()).to.equal(36n);
      for (const [index, holder] of holders.entries()) {
        expect(await token.balanceOf(holder.signer.address)).to.equal(received[index]);
      }
      await expect(claim.connect(donor).settleExpiredRounds()).not.to.emit(token, "Transfer");
      expect(await token.balanceOf(address)).to.equal(donated);
    });
  }

  it("does not grant a donor claim rights or reset a claimed flag or the round limit", async () => {
    const { token, claim, holders, start, roundEnds } = await deployWithBalances(
      [1800n, 3600n], { allocation: 3600n }
    );
    const donor = (await ethers.getSigners())[19];
    const address = await claim.getAddress();
    const holder = holders[0];
    await token.transfer(donor.address, E18);
    await time.increaseTo(start);
    await token.connect(donor).transfer(address, E18 - 1n);
    await expect(claim.connect(donor).claim(holder.balance, holder.proof))
      .to.be.revertedWithCustomError(claim, "InvalidProof");
    await claim.connect(holder.signer).claim(holder.balance, holder.proof);
    await token.connect(donor).transfer(address, 1n);
    await expect(claim.connect(holder.signer).claim(holder.balance, holder.proof))
      .to.be.revertedWithCustomError(claim, "AlreadyClaimed");
    await expect(claim.connect(holders[1].signer).claim(holders[1].balance, holders[1].proof))
      .to.be.revertedWithCustomError(claim, "RoundAllocationExceeded").withArgs(0n, 300n, 100n);
    expect(await claim.roundClaimed(0n)).to.equal(100n);
    expect(await claim.isClaimed(0n, donor.address)).to.equal(false);
    expect(await claim.isClaimed(0n, holders[1].signer.address)).to.equal(false);
    await time.increaseTo(roundEnds[35]);
    await claim.settleExpiredRounds();
    expect(await token.balanceOf(address)).to.equal(E18);
  });

  it("counts a third-party transfer as ordinary funding without creating extra entitlement", async () => {
    const { token, claim, holders, start, roundEnds, allocation } = await loadFixture(unfundedFixture);
    const donor = (await ethers.getSigners())[19];
    const address = await claim.getAddress();
    const holder = holders[0];
    await token.transfer(donor.address, holder.monthly);
    await token.connect(donor).transfer(address, holder.monthly);
    await token.transfer(address, allocation - holder.monthly);
    await time.increaseTo(start);
    await claim.connect(holder.signer).claim(holder.balance, holder.proof);
    await time.increaseTo(roundEnds[35]);
    await claim.connect(donor).settleExpiredRounds();
    expect(await token.balanceOf(holder.signer.address)).to.equal(holder.monthly);
    expect(await token.balanceOf(DEAD_ADDRESS)).to.equal(allocation - holder.monthly);
    expect(await token.balanceOf(address)).to.equal(0n);
    expect(await token.balanceOf(donor.address)).to.equal(0n);
  });

  it("leaves APM sent after final expiry or final settlement locked without reopening claims", async () => {
    const { token, claim, holders, roundEnds, allocation } = await loadFixture(deployFixture);
    const donor = (await ethers.getSigners())[19];
    const address = await claim.getAddress();
    const extra = 1_000_000n * E18;
    await token.transfer(donor.address, extra + 1n);
    await time.increaseTo(roundEnds[35]);
    await token.connect(donor).transfer(address, 1n);
    expect(await claim.settleExpiredRounds.staticCall()).to.deep.equal([36n, allocation]);
    await claim.settleExpiredRounds();
    expect(await token.balanceOf(address)).to.equal(1n);
    await token.connect(donor).transfer(address, extra);
    expect(await claim.settleExpiredRounds.staticCall()).to.deep.equal([0n, 0n]);
    await expect(claim.connect(donor).settleExpiredRounds()).not.to.emit(token, "Transfer");
    await expect(claim.connect(holders[0].signer).claim(holders[0].balance, holders[0].proof))
      .to.be.revertedWithCustomError(claim, "ClaimWindowClosed");
    expect(await token.balanceOf(DEAD_ADDRESS)).to.equal(allocation);
    expect(await token.balanceOf(address)).to.equal(extra + 1n);
  });

  it("ignores another ERC20 balance and rejects a direct native-currency transfer", async () => {
    const { token, claim, holders, start, roundEnds, allocation } = await loadFixture(deployFixture);
    const donor = (await ethers.getSigners())[19];
    const address = await claim.getAddress();
    const otherToken = await (await ethers.getContractFactory("ApmFashion"))
      .deploy([donor.address], [TOKEN_TOTAL]);
    await otherToken.waitForDeployment();
    await otherToken.connect(donor).transfer(address, TOKEN_TOTAL);
    await expect(donor.sendTransaction({ to: address, value: 1n })).to.be.reverted;
    expect(await claim.token()).to.equal(await token.getAddress());
    await time.increaseTo(start);
    const holder = holders[0];
    await claim.connect(holder.signer).claim(holder.balance, holder.proof);
    await time.increaseTo(roundEnds[35]);
    await claim.connect(donor).settleExpiredRounds();
    expect(await token.balanceOf(holder.signer.address)).to.equal(holder.monthly);
    expect(await token.balanceOf(DEAD_ADDRESS)).to.equal(allocation - holder.monthly);
    expect(await token.balanceOf(address)).to.equal(0n);
    expect(await otherToken.balanceOf(address)).to.equal(TOKEN_TOTAL);
    expect(await otherToken.balanceOf(DEAD_ADDRESS)).to.equal(0n);
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

  it("supports 36 five-minute rounds with exact boundaries, duplicate protection and settlement", async () => {
    const { token, claim, holders, start, roundEnds, allocation } = await deployWithBalances([1800n, 37n], { roundInterval: 300n });
    const monthlyTotal = holders.reduce((sum, holder) => sum + holder.monthly, 0n);
    await time.increaseTo(start - 1n);
    await expect(claim.currentRound()).to.be.revertedWithCustomError(claim, "ClaimWindowClosed");
    for (let round = 0; round < ROUND_COUNT; round++) {
      await time.increaseTo(round === 0 ? start : roundEnds[round - 1]);
      expect(await claim.currentRound()).to.equal(BigInt(round));
      await claim.settleExpiredRounds();
      for (const holder of holders) {
        await expect(claim.connect(holder.signer).claim(holder.balance, holder.proof))
          .to.emit(claim, "Claimed").withArgs(BigInt(round), holder.signer.address, holder.monthly);
      }
      await expect(claim.connect(holders[0].signer).claim(holders[0].balance, holders[0].proof))
        .to.be.revertedWithCustomError(claim, "AlreadyClaimed").withArgs(BigInt(round), holders[0].signer.address);
      expect(await claim.roundClaimed(round)).to.equal(monthlyTotal);
      await time.increaseTo(roundEnds[round] - 1n);
      expect(await claim.currentRound()).to.equal(BigInt(round));
    }
    await time.increaseTo(roundEnds[35]);
    await expect(claim.currentRound()).to.be.revertedWithCustomError(claim, "ClaimWindowClosed");
    await expect(claim.connect(holders[0].signer).claim(holders[0].balance, holders[0].proof))
      .to.be.revertedWithCustomError(claim, "ClaimWindowClosed");
    await claim.settleExpiredRounds();
    expect(await claim.nextRoundToSettle()).to.equal(36n);
    expect(await token.balanceOf(await claim.getAddress())).to.equal(0n);
    expect(await token.balanceOf(DEAD_ADDRESS)).to.equal(allocation - monthlyTotal * 36n);
    for (const holder of holders) {
      expect(await token.balanceOf(holder.signer.address)).to.equal(holder.monthly * 36n);
    }
  });

  it("allows deployment after the start without reopening expired rounds", async () => {
    const { token, tree, holders, start, roundEnds, allocation } = await loadFixture(deployFixture);
    await time.increaseTo(roundEnds[1]);
    const claim = await (await ethers.getContractFactory("GenesisClaim"))
      .deploy(await token.getAddress(), tree.root, start, roundEnds, allocation);
    await claim.waitForDeployment();
    await token.transfer(await claim.getAddress(), allocation);
    expect(await claim.startTimestamp()).to.equal(start);
    expect(await claim.currentRound()).to.equal(2n);
    await claim.settleExpiredRounds();
    expect(await claim.nextRoundToSettle()).to.equal(2n);
    expect(await token.balanceOf(DEAD_ADDRESS)).to.equal(allocation / 36n * 2n);
    const holder = holders[0];
    await expect(claim.connect(holder.signer).claim(holder.balance, holder.proof))
      .to.emit(claim, "Claimed").withArgs(2n, holder.signer.address, holder.monthly);
    expect(await claim.isClaimed(0n, holder.signer.address)).to.equal(false);
    expect(await claim.isClaimed(1n, holder.signer.address)).to.equal(false);
  });

  it("supports one-second rounds without imposing a minimum duration", async () => {
    const { token, claim, holders, start, roundEnds } = await deployWithBalances([1800n], { roundInterval: 1n });
    const holder = holders[0];
    for (let round = 0; round < ROUND_COUNT; round++) {
      await time.setNextBlockTimestamp(start + BigInt(round));
      await expect(claim.connect(holder.signer).claim(holder.balance, holder.proof))
        .to.emit(claim, "Claimed").withArgs(BigInt(round), holder.signer.address, holder.monthly);
    }
    await time.increaseTo(roundEnds[35]);
    await claim.settleExpiredRounds();
    expect(await token.balanceOf(holder.signer.address)).to.equal(holder.monthly * 36n);
    expect(await token.balanceOf(await claim.getAddress())).to.equal(0n);
    expect(await claim.nextRoundToSettle()).to.equal(36n);
  });

  it("allows a fully expired schedule but only permits settlement, not claims", async () => {
    const { token, tree, holders, start, roundEnds, allocation } = await loadFixture(deployFixture);
    await time.increaseTo(roundEnds[35]);
    const claim = await (await ethers.getContractFactory("GenesisClaim"))
      .deploy(await token.getAddress(), tree.root, start, roundEnds, allocation);
    await claim.waitForDeployment();
    await token.transfer(await claim.getAddress(), allocation);
    await expect(claim.currentRound()).to.be.revertedWithCustomError(claim, "ClaimWindowClosed");
    await expect(claim.connect(holders[0].signer).claim(holders[0].balance, holders[0].proof))
      .to.be.revertedWithCustomError(claim, "ClaimWindowClosed");
    await claim.settleExpiredRounds();
    expect(await token.balanceOf(DEAD_ADDRESS)).to.equal(allocation);
    expect(await token.balanceOf(await claim.getAddress())).to.equal(0n);
    expect(await claim.nextRoundToSettle()).to.equal(36n);
  });

  it("validates token, root, allocation and chronological round ends", async () => {
    const { token, tree, start, roundEnds, allocation } = await loadFixture(deployFixture);
    const Claim = await ethers.getContractFactory("GenesisClaim");
    const tokenAddress = await token.getAddress();
    await expect(Claim.deploy(ethers.ZeroAddress, tree.root, start, roundEnds, allocation))
      .to.be.revertedWithCustomError(Claim, "ZeroToken");
    await expect(Claim.deploy(tokenAddress, ethers.ZeroHash, start, roundEnds, allocation))
      .to.be.revertedWithCustomError(Claim, "ZeroMerkleRoot");
    await expect(Claim.deploy(tokenAddress, tree.root, start, roundEnds, 0n))
      .to.be.revertedWithCustomError(Claim, "ZeroAllocation");
    for (const round of [0, 1, 35]) {
      const previousEnd = round === 0 ? start : roundEnds[round - 1];
      for (const interval of [0n, -1n]) {
        const invalidEnds = [...roundEnds];
        invalidEnds[round] = previousEnd + interval;
        await expect(Claim.deploy(tokenAddress, tree.root, start, invalidEnds, allocation))
          .to.be.revertedWith(round === 0 ? "invalid first round end" : "round ends not increasing");
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
