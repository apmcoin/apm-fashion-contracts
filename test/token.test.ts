import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const TOTAL = 10_000_000_000n * 10n ** 18n;
const DAY = 24 * 60 * 60;
const MONTH = 30 * DAY;

async function deployToken(recipients: string[], amounts: bigint[]) {
  const Token = await ethers.getContractFactory("ApmFashion");
  return Token.deploy(recipients, amounts);
}

describe("ApmFashion", () => {
  it("mints exactly TOTAL_SUPPLY across recipients and exposes correct metadata", async () => {
    const [a, b] = await ethers.getSigners();
    const token = await deployToken([a.address, b.address], [TOTAL / 2n, TOTAL / 2n]);

    expect(await token.totalSupply()).to.equal(TOTAL);
    expect(await token.TOTAL_SUPPLY()).to.equal(TOTAL);
    expect(await token.balanceOf(a.address)).to.equal(TOTAL / 2n);
    expect(await token.name()).to.equal("apM Fashion");
    expect(await token.symbol()).to.equal("APM");
    expect(await token.decimals()).to.equal(18);
  });

  it("reverts when allocations != TOTAL_SUPPLY", async () => {
    const [a] = await ethers.getSigners();
    await expect(deployToken([a.address], [TOTAL - 1n])).to.be.revertedWith(
      "supply != TOTAL_SUPPLY"
    );
  });

  it("reverts on length mismatch", async () => {
    const [a] = await ethers.getSigners();
    await expect(deployToken([a.address], [TOTAL, 1n])).to.be.revertedWith(
      "len: recipients != amounts"
    );
  });

  it("reverts on zero amount entry", async () => {
    const [a, b] = await ethers.getSigners();
    await expect(deployToken([a.address, b.address], [TOTAL, 0n])).to.be.revertedWith(
      "zero amount entry"
    );
  });

  it("reverts on zero recipient (guarded by OZ _mint)", async () => {
    const Token = await ethers.getContractFactory("ApmFashion");
    await expect(deployToken([ethers.ZeroAddress], [TOTAL])).to.be.revertedWithCustomError(
      Token,
      "ERC20InvalidReceiver"
    );
  });

  it("has no owner / mint entrypoints (ownerless)", async () => {
    const [a] = await ethers.getSigners();
    const token = await deployToken([a.address], [TOTAL]);
    expect((token as any).owner).to.equal(undefined);
    expect((token as any).mint).to.equal(undefined);
  });
});

describe("ApmFashion - ERC20Permit (EIP-2612)", () => {
  it("sets allowance via a valid permit signature and bumps the nonce", async () => {
    const [owner, spender] = await ethers.getSigners();
    const token = await deployToken([owner.address], [TOTAL]);

    const value = 1_000n * 10n ** 18n;
    const deadline = (await time.latest()) + 3600;
    const nonce = await token.nonces(owner.address);

    const domain = {
      name: "apM Fashion",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await token.getAddress(),
    };
    const types = {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };
    const message = { owner: owner.address, spender: spender.address, value, nonce, deadline };

    const sig = await owner.signTypedData(domain, types, message);
    const { v, r, s } = ethers.Signature.from(sig);

    await token.permit(owner.address, spender.address, value, deadline, v, r, s);

    expect(await token.allowance(owner.address, spender.address)).to.equal(value);
    expect(await token.nonces(owner.address)).to.equal(nonce + 1n);
  });

  it("reverts a permit past its deadline", async () => {
    const [owner, spender] = await ethers.getSigners();
    const token = await deployToken([owner.address], [TOTAL]);

    const value = 1n;
    const deadline = (await time.latest()) - 1; // already expired
    const nonce = await token.nonces(owner.address);
    const domain = {
      name: "apM Fashion",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await token.getAddress(),
    };
    const types = {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };
    const message = { owner: owner.address, spender: spender.address, value, nonce, deadline };
    const sig = await owner.signTypedData(domain, types, message);
    const { v, r, s } = ethers.Signature.from(sig);

    await expect(
      token.permit(owner.address, spender.address, value, deadline, v, r, s)
    ).to.be.revertedWithCustomError(token, "ERC2612ExpiredSignature");
  });
});

// Vesting uses OpenZeppelin's stock VestingWallet (no custom code).
// Schedules are expressed purely via (start, duration). TGE assumed to be deploy + 1 day.
describe("VestingWallet (OpenZeppelin stock)", () => {
  // Deploy a vesting wallet holding the entire supply, with the given schedule.
  async function deployVested(startOffset: number, duration: number) {
    const [, beneficiary] = await ethers.getSigners();
    const tge = (await time.latest()) + DAY; // TGE = deploy + 1 day
    const start = tge + startOffset;

    const Vest = await ethers.getContractFactory("VestingWallet");
    const vest = await Vest.deploy(beneficiary.address, start, duration);
    const token = await deployToken([await vest.getAddress()], [TOTAL]);

    const releasable = (addr: string) => vest["releasable(address)"](addr);
    return { beneficiary, tge, start, vest, token, releasable };
  }

  it("pure linear (Genesis / Foundation: start=TGE, dur=24mo)", async () => {
    const duration = 24 * MONTH;
    const { tge, start, vest, token, releasable } = await deployVested(0, duration);
    const tokenAddr = await token.getAddress();

    await time.increaseTo(tge - 10);
    expect(await releasable(tokenAddr)).to.equal(0n);

    await time.increaseTo(start + duration / 2);
    expect(await releasable(tokenAddr)).to.equal(TOTAL / 2n);

    await time.increaseTo(start + duration);
    expect(await releasable(tokenAddr)).to.equal(TOTAL);
  });

  it("cliff + linear (Team: start=TGE+12mo, dur=24mo)", async () => {
    const duration = 24 * MONTH;
    const { tge, start, token, releasable } = await deployVested(12 * MONTH, duration);
    const tokenAddr = await token.getAddress();

    // during the 12-month cliff: nothing
    await time.increaseTo(tge + 6 * MONTH);
    expect(await releasable(tokenAddr)).to.equal(0n);

    // exactly at cliff/start: still 0 (linear just begins)
    await time.increaseTo(start);
    expect(await releasable(tokenAddr)).to.equal(0n);

    // halfway through the linear period
    await time.increaseTo(start + duration / 2);
    expect(await releasable(tokenAddr)).to.equal(TOTAL / 2n);

    await time.increaseTo(start + duration);
    expect(await releasable(tokenAddr)).to.equal(TOTAL);
  });

  it("pure cliff then full unlock (Rewards: start=TGE+6mo, dur=0)", async () => {
    const { tge, start, token, releasable } = await deployVested(6 * MONTH, 0);
    const tokenAddr = await token.getAddress();

    await time.increaseTo(start - 10);
    expect(await releasable(tokenAddr)).to.equal(0n);

    await time.increaseTo(start);
    expect(await releasable(tokenAddr)).to.equal(TOTAL); // duration 0 => 100% at start
  });

  it("release(token) transfers vested tokens to beneficiary and tracks accounting", async () => {
    const duration = 24 * MONTH;
    const { beneficiary, start, vest, token } = await deployVested(0, duration);
    const tokenAddr = await token.getAddress();

    await time.increaseTo(start + duration); // fully vested

    await expect(vest["release(address)"](tokenAddr))
      .to.emit(vest, "ERC20Released")
      .withArgs(tokenAddr, TOTAL);

    expect(await token.balanceOf(beneficiary.address)).to.equal(TOTAL);
    expect(await token.balanceOf(await vest.getAddress())).to.equal(0n);
    expect(await vest["released(address)"](tokenAddr)).to.equal(TOTAL);
  });
});
