import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

const ROUND_COUNT = 36;
const E18 = 10n ** 18n;
const TOKEN_TOTAL = 10_000_000_000n * E18;
const THIRTY_DAYS = 30n * 24n * 60n * 60n;
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";

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

function buildRoundAllocations(entitlements: bigint[], poolAllocation: bigint): bigint[] {
  const allocations = Array.from({ length: ROUND_COUNT - 1 }, (_, round) =>
    entitlements.reduce((sum, entitlement) => sum + roundAmount(entitlement, round), 0n)
  );
  const allocated = allocations.reduce((sum, amount) => sum + amount, 0n);
  return [...allocations, poolAllocation - allocated];
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
  const poolAllocation = entitlementA + entitlementB + 23n;
  const roundAllocations = buildRoundAllocations([entitlementA, entitlementB], poolAllocation);

  const Claim = await ethers.getContractFactory("GenesisClaim");
  const claim = await Claim.deploy(
    await token.getAddress(),
    root,
    start,
    roundEnds,
    roundAllocations
  );
  await claim.waitForDeployment();
  await token.transfer(await claim.getAddress(), poolAllocation);

  return {
    token,
    claim,
    userA,
    relayer,
    entitlementA,
    proofA: [leafB],
    start,
    roundEnds,
    roundAllocations,
    poolAllocation,
  };
}

describe("GenesisClaim", () => {
  it("is ownerless and permits one Merkle claim per account per round", async () => {
    const { token, claim, userA, relayer, entitlementA, proofA, start } =
      await loadFixture(deployFixture);
    await time.increaseTo(start);

    const expected = roundAmount(entitlementA, 0);
    await expect(claim.connect(relayer).claim(0n, userA.address, entitlementA, proofA))
      .to.emit(claim, "Claimed")
      .withArgs(0n, 0n, userA.address, expected);

    expect(await token.balanceOf(userA.address)).to.equal(expected);
    expect(await claim.isClaimed(0n, 0n)).to.equal(true);
    expect((claim as any).owner).to.equal(undefined);
    expect((claim as any).withdraw).to.equal(undefined);

    await expect(claim.claim(0n, userA.address, entitlementA, proofA))
      .to.be.revertedWithCustomError(claim, "AlreadyClaimed")
      .withArgs(0n, 0n);
  });

  it("rejects an altered entitlement", async () => {
    const { claim, userA, entitlementA, proofA, start } = await loadFixture(deployFixture);
    await time.increaseTo(start);

    await expect(claim.claim(0n, userA.address, entitlementA + 1n, proofA))
      .to.be.revertedWithCustomError(claim, "InvalidProof");
  });

  it("does not carry a missed monthly claim into a later round", async () => {
    const { token, claim, userA, entitlementA, proofA, roundEnds, roundAllocations } =
      await loadFixture(deployFixture);
    await time.increaseTo(roundEnds[0]);

    await claim.claim(0n, userA.address, entitlementA, proofA);
    await claim.settleExpiredRounds();

    expect(await token.balanceOf(DEAD_ADDRESS)).to.equal(roundAllocations[0]);
    expect(await claim.nextRoundToSettle()).to.equal(1n);
  });

  it("uses each account's remaining entitlement in the final round", async () => {
    const { claim, entitlementA } = await loadFixture(deployFixture);
    const baseAmount = entitlementA / BigInt(ROUND_COUNT);

    expect(await claim.roundAmount(entitlementA, 0n)).to.equal(baseAmount);
    expect(await claim.roundAmount(entitlementA, 35n)).to.equal(
      entitlementA - baseAmount * 35n
    );
  });

  it("sends the final unclaimed balance to the dead address", async () => {
    const { token, claim, roundEnds, poolAllocation } = await loadFixture(deployFixture);
    await time.increaseTo(roundEnds[35]);

    await claim.settleExpiredRounds();

    expect(await claim.nextRoundToSettle()).to.equal(36n);
    expect(await token.balanceOf(DEAD_ADDRESS)).to.equal(poolAllocation);
    expect(await token.balanceOf(await claim.getAddress())).to.equal(0n);
  });

  it("keeps every monthly interval between 28 and 31 days", async () => {
    const { token, claim, start, roundEnds, roundAllocations } = await loadFixture(deployFixture);
    const Claim = await ethers.getContractFactory("GenesisClaim");

    const tooShort = [...roundEnds];
    tooShort[1] = tooShort[0] + 28n * 24n * 60n * 60n - 1n;
    await expect(
      Claim.deploy(await token.getAddress(), await claim.merkleRoot(), start, tooShort, roundAllocations)
    ).to.be.revertedWith("round interval too short");

    const tooLong = [...roundEnds];
    tooLong[1] = tooLong[0] + 31n * 24n * 60n * 60n + 1n;
    await expect(
      Claim.deploy(await token.getAddress(), await claim.merkleRoot(), start, tooLong, roundAllocations)
    ).to.be.revertedWith("round interval too long");
  });
});
