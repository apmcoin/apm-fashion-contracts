import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const E18 = 10n ** 18n;
const TOTAL = 10_000_000_000n * E18;
const DAY = 24 * 60 * 60;
const MONTH = 30 * DAY;

// A valid genesis configuration whose amounts sum to TOTAL_SUPPLY.
//   lock[0] pure linear        4B  start=TGE,        dur=24mo
//   lock[1] cliff + linear     3B  start=TGE+12mo,   dur=24mo
//   lock[2] pure cliff (full)  2B  start=TGE+6mo,    dur=0
//   free[0] exchange           1B
async function deployGenesis() {
  const signers = await ethers.getSigners();
  const [, benLinear, benCliff, benPure, exchange] = signers;
  const tge = (await time.latest()) + DAY;

  const lockBeneficiaries = [benLinear.address, benCliff.address, benPure.address];
  const lockAmounts = [4_000_000_000n * E18, 3_000_000_000n * E18, 2_000_000_000n * E18];
  const lockStarts = [tge, tge + 12 * MONTH, tge + 6 * MONTH];
  const lockDurations = [24 * MONTH, 24 * MONTH, 0];
  const freeRecipients = [exchange.address];
  const freeAmounts = [1_000_000_000n * E18];

  const Token = await ethers.getContractFactory("ApmFashion");
  const token = await Token.deploy(
    lockBeneficiaries,
    lockAmounts,
    lockStarts,
    lockDurations,
    freeRecipients,
    freeAmounts
  );
  await token.waitForDeployment();

  const events = await token.queryFilter(token.filters.VestingDeployed());
  const wallets = events.map((e) => ({
    beneficiary: e.args.beneficiary as string,
    wallet: e.args.wallet as string,
    amount: e.args.amount as bigint,
    start: Number(e.args.start),
    duration: Number(e.args.duration),
  }));

  return { token, tge, wallets, exchange, lockAmounts };
}

describe("ApmFashion", () => {
  it("mints exactly TOTAL_SUPPLY and exposes correct metadata", async () => {
    const { token } = await deployGenesis();
    expect(await token.totalSupply()).to.equal(TOTAL);
    expect(await token.TOTAL_SUPPLY()).to.equal(TOTAL);
    expect(await token.name()).to.equal("apM Fashion");
    expect(await token.symbol()).to.equal("APM");
    expect(await token.decimals()).to.equal(18);
  });

  it("deploys one vesting wallet per locked tranche, each holding its amount", async () => {
    const { token, wallets, lockAmounts } = await deployGenesis();
    expect(wallets.length).to.equal(3);
    for (let i = 0; i < wallets.length; i++) {
      expect(wallets[i].amount).to.equal(lockAmounts[i]);
      expect(await token.balanceOf(wallets[i].wallet)).to.equal(lockAmounts[i]);
    }
  });

  it("mints free tranches directly to recipients", async () => {
    const { token, exchange } = await deployGenesis();
    expect(await token.balanceOf(exchange.address)).to.equal(1_000_000_000n * E18);
  });

  it("is a standard ERC20 with no transfer restrictions (free tokens move freely)", async () => {
    const { token, exchange } = await deployGenesis();
    const [, , , , , other] = await ethers.getSigners();
    await token.connect(exchange).transfer(other.address, 1000n * E18);
    expect(await token.balanceOf(other.address)).to.equal(1000n * E18);
  });

  it("has no owner / mint entrypoints (ownerless)", async () => {
    const { token } = await deployGenesis();
    expect((token as any).owner).to.equal(undefined);
    expect((token as any).mint).to.equal(undefined);
  });
});

describe("ApmFashion - constructor guards", () => {
  async function deployBad(overrides: Partial<{
    lockBeneficiaries: string[];
    lockAmounts: bigint[];
    lockStarts: number[];
    lockDurations: number[];
    freeRecipients: string[];
    freeAmounts: bigint[];
  }>) {
    const [, ben, exchange] = await ethers.getSigners();
    const tge = (await time.latest()) + DAY;
    const base = {
      lockBeneficiaries: [ben.address],
      lockAmounts: [9_000_000_000n * E18],
      lockStarts: [tge],
      lockDurations: [24 * MONTH],
      freeRecipients: [exchange.address],
      freeAmounts: [1_000_000_000n * E18],
    };
    const cfg = { ...base, ...overrides };
    const Token = await ethers.getContractFactory("ApmFashion");
    return Token.deploy(
      cfg.lockBeneficiaries,
      cfg.lockAmounts,
      cfg.lockStarts,
      cfg.lockDurations,
      cfg.freeRecipients,
      cfg.freeAmounts
    );
  }

  it("reverts when total != TOTAL_SUPPLY", async () => {
    await expect(deployBad({ freeAmounts: [1n * E18] })).to.be.revertedWith(
      "supply != TOTAL_SUPPLY"
    );
  });

  it("reverts on lock array length mismatch", async () => {
    await expect(deployBad({ lockDurations: [24 * MONTH, 12 * MONTH] })).to.be.revertedWith(
      "lock arrays length mismatch"
    );
  });

  it("reverts on free array length mismatch", async () => {
    await expect(deployBad({ freeAmounts: [1_000_000_000n * E18, 1n] })).to.be.revertedWith(
      "free arrays length mismatch"
    );
  });

  it("reverts on zero lock amount", async () => {
    await expect(deployBad({ lockAmounts: [0n] })).to.be.revertedWith("zero lock amount");
  });

  it("reverts on lock start in the past", async () => {
    const now = await time.latest();
    await expect(deployBad({ lockStarts: [now - 10] })).to.be.revertedWith("start in past");
  });
});

describe("ApmFashion - vesting behaviour (OZ VestingWallet)", () => {
  it("pure linear wallet: 0 before start, half at mid, full at end", async () => {
    const { token, tge, wallets } = await deployGenesis();
    const w = wallets[0]; // linear, start=tge, dur=24mo, amount=4B
    const vest = await ethers.getContractAt("VestingWallet", w.wallet);
    const tokenAddr = await token.getAddress();
    const releasable = (a: string) => vest["releasable(address)"](a);

    await time.increaseTo(tge - 5);
    expect(await releasable(tokenAddr)).to.equal(0n);

    await time.increaseTo(w.start + w.duration / 2);
    expect(await releasable(tokenAddr)).to.equal(w.amount / 2n);

    await time.increaseTo(w.start + w.duration);
    expect(await releasable(tokenAddr)).to.equal(w.amount);
  });

  it("pure cliff wallet (dur=0): 0 before start, full at start", async () => {
    const { token, wallets } = await deployGenesis();
    const w = wallets[2]; // pure cliff, start=tge+6mo, dur=0, amount=2B
    const vest = await ethers.getContractAt("VestingWallet", w.wallet);
    const tokenAddr = await token.getAddress();
    const releasable = (a: string) => vest["releasable(address)"](a);

    await time.increaseTo(w.start - 5);
    expect(await releasable(tokenAddr)).to.equal(0n);

    await time.increaseTo(w.start);
    expect(await releasable(tokenAddr)).to.equal(w.amount);
  });

  it("release(token) transfers vested tokens to the beneficiary", async () => {
    const { token, wallets } = await deployGenesis();
    const w = wallets[0];
    const vest = await ethers.getContractAt("VestingWallet", w.wallet);
    const tokenAddr = await token.getAddress();

    await time.increaseTo(w.start + w.duration); // fully vested
    await expect(vest["release(address)"](tokenAddr))
      .to.emit(vest, "ERC20Released")
      .withArgs(tokenAddr, w.amount);

    expect(await token.balanceOf(w.beneficiary)).to.equal(w.amount);
    expect(await token.balanceOf(w.wallet)).to.equal(0n);
  });
});

describe("ApmFashion - ERC20Permit (EIP-2612)", () => {
  it("sets allowance via a valid permit signature and bumps the nonce", async () => {
    const { token, exchange } = await deployGenesis();
    const [, , , , , spender] = await ethers.getSigners();

    const value = 1_000n * E18;
    const deadline = (await time.latest()) + 3600;
    const nonce = await token.nonces(exchange.address);
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
    const message = {
      owner: exchange.address,
      spender: spender.address,
      value,
      nonce,
      deadline,
    };
    const sig = await exchange.signTypedData(domain, types, message);
    const { v, r, s } = ethers.Signature.from(sig);

    await token.permit(exchange.address, spender.address, value, deadline, v, r, s);
    expect(await token.allowance(exchange.address, spender.address)).to.equal(value);
    expect(await token.nonces(exchange.address)).to.equal(nonce + 1n);
  });
});
