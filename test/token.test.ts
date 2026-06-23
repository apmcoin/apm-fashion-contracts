import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const TOTAL = 10_000_000_000n * 10n ** 18n;
const DAY = 24 * 60 * 60;

describe("ApmFashion", () => {
  it("mints exactly TOTAL_SUPPLY across recipients and exposes correct metadata", async () => {
    const [a, b] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("ApmFashion");
    const token = await Token.deploy([a.address, b.address], [TOTAL / 2n, TOTAL / 2n]);

    expect(await token.totalSupply()).to.equal(TOTAL);
    expect(await token.TOTAL_SUPPLY()).to.equal(TOTAL);
    expect(await token.balanceOf(a.address)).to.equal(TOTAL / 2n);
    expect(await token.name()).to.equal("apM Fashion");
    expect(await token.symbol()).to.equal("APM");
    expect(await token.decimals()).to.equal(18);
  });

  it("reverts when allocations != TOTAL_SUPPLY", async () => {
    const [a] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("ApmFashion");
    await expect(Token.deploy([a.address], [TOTAL - 1n])).to.be.revertedWith(
      "supply != TOTAL_SUPPLY"
    );
  });

  it("reverts on length mismatch", async () => {
    const [a] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("ApmFashion");
    await expect(Token.deploy([a.address], [TOTAL, 1n])).to.be.revertedWith(
      "len: recipients != amounts"
    );
  });

  it("reverts on zero amount entry", async () => {
    const [a, b] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("ApmFashion");
    await expect(
      Token.deploy([a.address, b.address], [TOTAL, 0n])
    ).to.be.revertedWith("zero amount entry");
  });

  it("reverts on zero recipient (guarded by OZ _mint)", async () => {
    const Token = await ethers.getContractFactory("ApmFashion");
    await expect(
      Token.deploy([ethers.ZeroAddress], [TOTAL])
    ).to.be.revertedWithCustomError(Token, "ERC20InvalidReceiver");
  });

  it("has no owner / mint entrypoints (ownerless)", async () => {
    const [a] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("ApmFashion");
    const token = await Token.deploy([a.address], [TOTAL]);
    expect((token as any).owner).to.equal(undefined);
    expect((token as any).mint).to.equal(undefined);
  });
});

describe("CliffVestingWallet", () => {
  it("locks before cliff, partially releases after cliff, fully after end", async () => {
    const [, beneficiary] = await ethers.getSigners();
    const now = await time.latest();
    const start = now + 100;
    const duration = 400 * DAY;
    const cliff = 100 * DAY;

    const Vest = await ethers.getContractFactory("CliffVestingWallet");
    const vest = await Vest.deploy(beneficiary.address, start, duration, cliff);

    const Token = await ethers.getContractFactory("ApmFashion");
    const token = await Token.deploy([await vest.getAddress()], [TOTAL]);
    const tokenAddr = await token.getAddress();

    // VestingWallet exposes releasable() and releasable(address); disambiguate for ethers v6.
    const releasableToken = (addr: string) =>
      vest["releasable(address)"](addr);

    await time.increaseTo(start + cliff - 10);
    expect(await releasableToken(tokenAddr)).to.equal(0n);

    await time.increaseTo(start + cliff + DAY);
    expect(await releasableToken(tokenAddr)).to.be.greaterThan(0n);

    await time.increaseTo(start + duration + 1);
    expect(await releasableToken(tokenAddr)).to.equal(TOTAL);
  });

  it("reverts on start in the past", async () => {
    const [, beneficiary] = await ethers.getSigners();
    const now = await time.latest();
    const Vest = await ethers.getContractFactory("CliffVestingWallet");
    await expect(
      Vest.deploy(beneficiary.address, now - 10, 1000, 100)
    ).to.be.revertedWith("start in past");
  });

  it("reverts when cliff > duration", async () => {
    const [, beneficiary] = await ethers.getSigners();
    const now = await time.latest();
    const Vest = await ethers.getContractFactory("CliffVestingWallet");
    await expect(
      Vest.deploy(beneficiary.address, now + 100, 1000, 2000)
    ).to.be.revertedWith("cliff > duration");
  });
});
