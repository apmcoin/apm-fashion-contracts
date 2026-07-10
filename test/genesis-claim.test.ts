import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

const ROUND_COUNT = 36;
const E18 = 10n ** 18n;
const TOKEN_TOTAL = 10_000_000_000n * E18;
const THIRTY_DAYS = 30n * 24n * 60n * 60n;
const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD";

function leafHash(index: bigint, account: string, totalEntitlement: bigint): string {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "address", "uint256"],
    [index, account, totalEntitlement]
  );
  return ethers.keccak256(ethers.keccak256(encoded));
}

function hashPair(a: string, b: string): string {
  const [left, right] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return ethers.keccak256(ethers.concat([left, right]));
}

function roundAmount(totalEntitlement: bigint, round: number): bigint {
  const baseAmount = totalEntitlement / BigInt(ROUND_COUNT);
  return round < ROUND_COUNT - 1
    ? baseAmount
    : totalEntitlement - baseAmount * BigInt(ROUND_COUNT - 1);
}

function buildRoundAllocations(entitlements: bigint[]): bigint[] {
  return Array.from({ length: ROUND_COUNT }, (_, round) =>
    entitlements.reduce((sum, entitlement) => sum + roundAmount(entitlement, round), 0n)
  );
}

async function deployFixture() {
  const [deployer, userA, userB, relayer] = await ethers.getSigners();

  const Token = await ethers.getContractFactory("ApmFashion");
  const token = await Token.deploy([deployer.address], [TOKEN_TOTAL]);
  await token.waitForDeployment();

  const entitlementA = 3_600n * E18 + 17n;
  const entitlementB = 7_200n * E18 + 19n;
  const leafA = leafHash(0n, userA.address, entitlementA);
  const leafB = leafHash(1n, userB.address, entitlementB);
  const root = hashPair(leafA, leafB);

  const start = BigInt(await time.latest()) + 100n;
  const roundEnds = Array.from(
    { length: ROUND_COUNT },
    (_, round) => start + BigInt(round + 1) * THIRTY_DAYS
  );
  const roundAllocations = buildRoundAllocations([entitlementA, entitlementB]);
  const totalAllocation = entitlementA + entitlementB;

  const Claim = await ethers.getContractFactory("GenesisClaim");
  const claim = await Claim.deploy(
    await token.getAddress(),
    root,
    start,
    roundEnds,
    roundAllocations
  );
  await claim.waitForDeployment();
  await token.transfer(await claim.getAddress(), totalAllocation);

  return {
    token,
    claim,
    userA,
    userB,
    relayer,
    entitlementA,
    entitlementB,
    proofA: [leafB],
    proofB: [leafA],
    root,
    start,
    roundEnds,
    roundAllocations,
    totalAllocation,
  };
}

describe("GenesisClaim", () => {
  it("is ownerless and permits one Merkle claim per user per round", async () => {
    const { token, claim, userA, relayer, entitlementA, proofA, start } =
      await loadFixture(deployFixture);
    await time.increaseTo(start);

    const expected = roundAmount(entitlementA, 0);
    await expect(claim.connect(relayer).claim(0n, userA.address, entitlementA, proofA))
      .to.emit(claim, "Claimed")
      .withArgs(0n, 0n, userA.address, expected);

    expect(await token.balanceOf(userA.address)).to.equal(expected);
    expect(await claim.isClaimed(0n, 0n)).to.equal(true);
    expect(await claim.roundClaimed(0n)).to.equal(expected);
    expect((claim as any).owner).to.equal(undefined);
    expect((claim as any).withdraw).to.equal(undefined);

    await expect(claim.claim(0n, userA.address, entitlementA, proofA))
      .to.be.revertedWithCustomError(claim, "AlreadyClaimed")
      .withArgs(0n, 0n);
  });

  it("rejects a proof when the committed entitlement is altered", async () => {
    const { claim, userA, entitlementA, proofA, start } = await loadFixture(deployFixture);
    await time.increaseTo(start);

    await expect(
      claim.claim(0n, userA.address, entitlementA + 1n, proofA)
    ).to.be.revertedWithCustomError(claim, "InvalidProof");
    expect(await claim.isClaimed(0n, 0n)).to.equal(false);
  });

  it("rejects a valid proof that exceeds the configured round allocation", async () => {
    const { token, userA, entitlementA, proofA, root, start, roundEnds, roundAllocations } =
      await loadFixture(deployFixture);
    const expected = roundAmount(entitlementA, 0);
    const constrainedAllocations = [...roundAllocations];
    constrainedAllocations[0] = expected - 1n;

    const Claim = await ethers.getContractFactory("GenesisClaim");
    const constrainedClaim = await Claim.deploy(
      await token.getAddress(),
      root,
      start,
      roundEnds,
      constrainedAllocations
    );
    await constrainedClaim.waitForDeployment();
    await time.increaseTo(start);

    await expect(constrainedClaim.claim(0n, userA.address, entitlementA, proofA))
      .to.be.revertedWithCustomError(constrainedClaim, "RoundAllocationExceeded")
      .withArgs(0n, expected, expected - 1n);
  });

  it("keeps claim and expired-round settlement independent", async () => {
    const { token, claim, userA, entitlementA, proofA, roundEnds, roundAllocations, totalAllocation } =
      await loadFixture(deployFixture);
    await time.increaseTo(roundEnds[0]);

    const currentAmount = roundAmount(entitlementA, 1);
    await claim.claim(0n, userA.address, entitlementA, proofA);

    expect(await claim.nextRoundToSettle()).to.equal(0n);
    expect(await token.balanceOf(BURN_ADDRESS)).to.equal(0n);

    await expect(claim.settleExpiredRounds())
      .to.emit(claim, "RoundSettled")
      .withArgs(0n, roundAllocations[0], 0n, roundAllocations[0]);

    expect(await claim.nextRoundToSettle()).to.equal(1n);
    expect(await token.balanceOf(BURN_ADDRESS)).to.equal(roundAllocations[0]);
    expect(await token.balanceOf(await claim.getAddress())).to.equal(
      totalAllocation - currentAmount - roundAllocations[0]
    );
  });

  it("burns the entire allocation of a round with zero claimants", async () => {
    const { token, claim, roundEnds, roundAllocations } = await loadFixture(deployFixture);
    await time.increaseTo(roundEnds[0]);

    await claim.settleExpiredRounds();

    expect(await claim.roundClaimed(0n)).to.equal(0n);
    expect(await token.balanceOf(BURN_ADDRESS)).to.equal(roundAllocations[0]);
  });

  it("puts each user's division remainder into the final round", async () => {
    const { claim, entitlementA } = await loadFixture(deployFixture);
    const baseAmount = entitlementA / BigInt(ROUND_COUNT);

    expect(await claim.roundAmount(entitlementA, 0n)).to.equal(baseAmount);
    expect(await claim.roundAmount(entitlementA, 34n)).to.equal(baseAmount);
    expect(await claim.roundAmount(entitlementA, 35n)).to.equal(
      entitlementA - baseAmount * 35n
    );
  });

  it("selects the correct round at monthly boundaries", async () => {
    const { claim, start, roundEnds } = await loadFixture(deployFixture);

    await time.increaseTo(start);
    expect(await claim.currentRound()).to.equal(0n);

    await time.increaseTo(roundEnds[16]);
    expect(await claim.currentRound()).to.equal(17n);

    await time.increaseTo(roundEnds[34]);
    expect(await claim.currentRound()).to.equal(35n);
  });

  it("burns the unclaimed balance after a partially claimed final round", async () => {
    const { token, claim, userA, entitlementA, proofA, roundEnds, roundAllocations, totalAllocation } =
      await loadFixture(deployFixture);
    await time.increaseTo(roundEnds[34]);

    const finalAmount = roundAmount(entitlementA, 35);
    await claim.claim(0n, userA.address, entitlementA, proofA);
    await claim.settleExpiredRounds();

    const firstThirtyFive = roundAllocations
      .slice(0, 35)
      .reduce((sum, allocation) => sum + allocation, 0n);
    expect(await token.balanceOf(BURN_ADDRESS)).to.equal(firstThirtyFive);

    await time.increaseTo(roundEnds[35]);
    await expect(claim.settleExpiredRounds())
      .to.emit(claim, "RoundSettled")
      .withArgs(35n, roundAllocations[35], finalAmount, roundAllocations[35] - finalAmount);

    expect(await claim.nextRoundToSettle()).to.equal(36n);
    expect(await token.balanceOf(BURN_ADDRESS)).to.equal(totalAllocation - finalAmount);
    expect(await token.balanceOf(userA.address)).to.equal(finalAmount);
    expect(await token.balanceOf(await claim.getAddress())).to.equal(0n);
  });

  it("burns the full allocation when all 36 rounds have zero claimants", async () => {
    const { token, claim, roundEnds, totalAllocation } = await loadFixture(deployFixture);
    await time.increaseTo(roundEnds[35]);

    await claim.settleExpiredRounds();

    expect(await claim.nextRoundToSettle()).to.equal(36n);
    expect(await token.balanceOf(BURN_ADDRESS)).to.equal(totalAllocation);
    expect(await token.balanceOf(await claim.getAddress())).to.equal(0n);

    await claim.settleExpiredRounds();
    expect(await claim.nextRoundToSettle()).to.equal(36n);
    expect(await token.balanceOf(BURN_ADDRESS)).to.equal(totalAllocation);
  });

  it("allows no-op settlement before TGE and rejects post-final claims", async () => {
    const { claim, userA, entitlementA, proofA, roundEnds } = await loadFixture(deployFixture);

    await claim.settleExpiredRounds();
    expect(await claim.nextRoundToSettle()).to.equal(0n);

    await time.increaseTo(roundEnds[35]);
    await expect(claim.claim(0n, userA.address, entitlementA, proofA)).to.be.revertedWithCustomError(
      claim,
      "ClaimWindowClosed"
    );
  });

  it("requires strictly increasing round end timestamps", async () => {
    const { token, root, start, roundEnds, roundAllocations } = await loadFixture(deployFixture);
    const invalidEnds = [...roundEnds];
    invalidEnds[1] = invalidEnds[0];

    const Claim = await ethers.getContractFactory("GenesisClaim");
    await expect(
      Claim.deploy(await token.getAddress(), root, start, invalidEnds, roundAllocations)
    ).to.be.revertedWith("round ends not increasing");
  });

  it("requires every round interval to stay between 28 and 31 days", async () => {
    const { token, root, start, roundEnds, roundAllocations } = await loadFixture(deployFixture);
    const Claim = await ethers.getContractFactory("GenesisClaim");

    const tooShort = [...roundEnds];
    tooShort[1] = tooShort[0] + 28n * 24n * 60n * 60n - 1n;
    await expect(
      Claim.deploy(await token.getAddress(), root, start, tooShort, roundAllocations)
    ).to.be.revertedWith("round interval too short");

    const tooLong = [...roundEnds];
    tooLong[1] = tooLong[0] + 31n * 24n * 60n * 60n + 1n;
    await expect(
      Claim.deploy(await token.getAddress(), root, start, tooLong, roundAllocations)
    ).to.be.revertedWith("round interval too long");
  });

  it("rejects a zero round allocation", async () => {
    const { claim, token, root, start, roundEnds, roundAllocations } =
      await loadFixture(deployFixture);
    const invalidAllocations = [...roundAllocations];
    invalidAllocations[7] = 0n;

    const Claim = await ethers.getContractFactory("GenesisClaim");
    await expect(
      Claim.deploy(await token.getAddress(), root, start, roundEnds, invalidAllocations)
    )
      .to.be.revertedWithCustomError(claim, "ZeroRoundAllocation")
      .withArgs(7n);
  });
});
