import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const E18 = 10n ** 18n;
const TOTAL = 10_000_000_000n * E18;
const DAY = 24 * 60 * 60;
const MONTH = 30 * DAY;

async function deployToken(recipients: string[], amounts: bigint[]) {
  const Token = await ethers.getContractFactory("ApmFashion");
  return Token.deploy(recipients, amounts);
}

describe("ApmFashion", () => {
  it("mints exactly TOTAL_SUPPLY and exposes correct metadata", async () => {
    const [a, b] = await ethers.getSigners();
    const token = await deployToken([a.address, b.address], [TOTAL / 2n, TOTAL / 2n]);
    expect(await token.totalSupply()).to.equal(TOTAL);
    expect(await token.TOTAL_SUPPLY()).to.equal(TOTAL);
    expect(await token.balanceOf(a.address)).to.equal(TOTAL / 2n);
    expect(await token.name()).to.equal("apM Fashion");
    expect(await token.symbol()).to.equal("APM");
    expect(await token.decimals()).to.equal(18);
  });

  it("reverts when total != TOTAL_SUPPLY", async () => {
    const [a] = await ethers.getSigners();
    await expect(deployToken([a.address], [TOTAL - 1n])).to.be.revertedWith("supply != TOTAL_SUPPLY");
  });

  it("reverts on array length mismatch", async () => {
    const [a] = await ethers.getSigners();
    await expect(deployToken([a.address], [TOTAL, 1n])).to.be.revertedWith("array length mismatch");
  });

  it("reverts on zero recipient", async () => {
    await expect(deployToken([ethers.ZeroAddress], [TOTAL])).to.be.revertedWith("zero recipient");
  });

  it("has no owner / mint entrypoints (ownerless)", async () => {
    const [a] = await ethers.getSigners();
    const token = await deployToken([a.address], [TOTAL]);
    expect((token as any).owner).to.equal(undefined);
    expect((token as any).mint).to.equal(undefined);
  });

  it("is a standard ERC20 (free transfer)", async () => {
    const [a, , c] = await ethers.getSigners();
    const token = await deployToken([a.address], [TOTAL]);
    await token.transfer(c.address, 1000n * E18);
    expect(await token.balanceOf(c.address)).to.equal(1000n * E18);
  });
});

describe("ApmFashion + VestingWallet (deployment integration)", () => {
  it("minting into a VestingWallet vests over time", async () => {
    const [, beneficiary] = await ethers.getSigners();
    const start = (await time.latest()) + DAY;
    const duration = 24 * MONTH;

    const Vest = await ethers.getContractFactory("VestingWallet");
    const vest = await Vest.deploy(beneficiary.address, start, duration);
    await vest.waitForDeployment();
    const vestAddr = await vest.getAddress();

    const token = await deployToken([vestAddr], [TOTAL]);
    const tokenAddr = await token.getAddress();
    const releasable = (x: string) => vest["releasable(address)"](x);

    expect(await token.balanceOf(vestAddr)).to.equal(TOTAL);

    await time.increaseTo(start - 5);
    expect(await releasable(tokenAddr)).to.equal(0n);

    await time.increaseTo(start + duration / 2);
    expect(await releasable(tokenAddr)).to.equal(TOTAL / 2n);

    await time.increaseTo(start + duration);
    expect(await releasable(tokenAddr)).to.equal(TOTAL);

    await vest["release(address)"](tokenAddr);
    expect(await token.balanceOf(beneficiary.address)).to.equal(TOTAL);
  });
});

describe("ApmFashion - ERC20Permit (EIP-2612)", () => {
  it("sets allowance via permit and bumps nonce", async () => {
    const [owner, spender] = await ethers.getSigners();
    const token = await deployToken([owner.address], [TOTAL]);
    const value = 1000n * E18;
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
});
