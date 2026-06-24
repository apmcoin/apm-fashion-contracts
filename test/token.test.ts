import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const E18 = 10n ** 18n;
const TOTAL = 10_000_000_000n * E18;
const DAY = 24 * 60 * 60;
const MONTH = 30 * DAY; // test-only convenience; real deploy uses calendar dates

// The tentative distribution table, every pool expressed as a VestingWallet:
//   Genesis Airdrop    44%  start=TGE,        dur=24mo
//   Foundation         21%  start=TGE,        dur=24mo
//   Team               10%  start=TGE+12mo,   dur=24mo
//   Rewards            15%  start=TGE+6mo,    dur=0   (full unlock at cliff)
//   Investors           5%  start=TGE+6mo,    dur=18mo
//   Exchange Airdrop     5%  start=TGE,        dur=0   (liquid at TGE)
async function deployGenesis() {
  const s = await ethers.getSigners();
  const [, genesis, foundation, team, rewards, investors, exchange] = s;
  const tge = (await time.latest()) + DAY;

  const beneficiaries = [
    genesis.address,
    foundation.address,
    team.address,
    rewards.address,
    investors.address,
    exchange.address,
  ];
  const amounts = [
    4_400_000_000n * E18,
    2_100_000_000n * E18,
    1_000_000_000n * E18,
    1_500_000_000n * E18,
    500_000_000n * E18,
    500_000_000n * E18,
  ];
  const starts = [tge, tge, tge + 12 * MONTH, tge + 6 * MONTH, tge + 6 * MONTH, tge];
  const durations = [24 * MONTH, 24 * MONTH, 24 * MONTH, 0, 18 * MONTH, 0];

  const Token = await ethers.getContractFactory("ApmFashion");
  const token = await Token.deploy(beneficiaries, amounts, starts, durations);
  await token.waitForDeployment();

  const events = await token.queryFilter(token.filters.VestingDeployed());
  const wallets = events.map((e) => ({
    beneficiary: e.args.beneficiary as string,
    wallet: e.args.wallet as string,
    amount: e.args.amount as bigint,
    start: Number(e.args.start),
    duration: Number(e.args.duration),
  }));

  return { token, tge, wallets, signers: { genesis, exchange } };
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

  it("deploys one vesting wallet per pool, each holding its amount", async () => {
    const { token, wallets } = await deployGenesis();
    expect(wallets.length).to.equal(6);
    let sum = 0n;
    for (const w of wallets) {
      expect(await token.balanceOf(w.wallet)).to.equal(w.amount);
      sum += w.amount;
    }
    expect(sum).to.equal(TOTAL);
  });

  it("has no owner / mint entrypoints (ownerless)", async () => {
    const { token } = await deployGenesis();
    expect((token as any).owner).to.equal(undefined);
    expect((token as any).mint).to.equal(undefined);
  });
});

describe("ApmFashion - constructor guards", () => {
  async function deployBad(
    overrides: Partial<{
      beneficiaries: string[];
      amounts: bigint[];
      starts: number[];
      durations: number[];
    }>
  ) {
    const [, a] = await ethers.getSigners();
    const tge = (await time.latest()) + DAY;
    const base = {
      beneficiaries: [a.address],
      amounts: [TOTAL],
      starts: [tge],
      durations: [24 * MONTH],
    };
    const cfg = { ...base, ...overrides };
    const Token = await ethers.getContractFactory("ApmFashion");
    return Token.deploy(cfg.beneficiaries, cfg.amounts, cfg.starts, cfg.durations);
  }

  it("reverts when total != TOTAL_SUPPLY", async () => {
    await expect(deployBad({ amounts: [TOTAL - 1n] })).to.be.revertedWith("supply != TOTAL_SUPPLY");
  });

  it("reverts on array length mismatch", async () => {
    await expect(deployBad({ durations: [24 * MONTH, 12 * MONTH] })).to.be.revertedWith(
      "array length mismatch"
    );
  });

  it("reverts on zero beneficiary", async () => {
    await expect(deployBad({ beneficiaries: [ethers.ZeroAddress] })).to.be.revertedWith(
      "zero beneficiary"
    );
  });
});

describe("ApmFashion - vesting behaviour (OZ VestingWallet)", () => {
  it("linear pool (Genesis): 0 before start, half at mid, full at end", async () => {
    const { token, tge, wallets } = await deployGenesis();
    const w = wallets[0]; // Genesis: start=tge, dur=24mo, 4.4B
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

  it("liquid pool (Exchange, dur=0): 0 before TGE, full at TGE", async () => {
    const { token, wallets } = await deployGenesis();
    const w = wallets[5]; // Exchange: start=tge, dur=0, 0.5B
    const vest = await ethers.getContractAt("VestingWallet", w.wallet);
    const tokenAddr = await token.getAddress();
    const releasable = (a: string) => vest["releasable(address)"](a);

    await time.increaseTo(w.start - 5);
    expect(await releasable(tokenAddr)).to.equal(0n);

    await time.increaseTo(w.start);
    expect(await releasable(tokenAddr)).to.equal(w.amount);
  });

  it("release(token) makes a liquid pool's tokens transferable", async () => {
    const { token, wallets, signers } = await deployGenesis();
    const w = wallets[5]; // Exchange pool
    const vest = await ethers.getContractAt("VestingWallet", w.wallet);
    const tokenAddr = await token.getAddress();
    const [, , , , , , , other] = await ethers.getSigners();

    await time.increaseTo(w.start); // fully releasable
    await vest["release(address)"](tokenAddr);
    expect(await token.balanceOf(signers.exchange.address)).to.equal(w.amount);

    // now a standard ERC20 transfer works (no restriction on the token)
    await token.connect(signers.exchange).transfer(other.address, 1000n * E18);
    expect(await token.balanceOf(other.address)).to.equal(1000n * E18);
  });
});

describe("ApmFashion - ERC20Permit (EIP-2612)", () => {
  it("sets allowance via a valid permit signature and bumps the nonce", async () => {
    const { token, wallets, signers } = await deployGenesis();
    const w = wallets[5];
    const vest = await ethers.getContractAt("VestingWallet", w.wallet);
    const tokenAddr = await token.getAddress();
    const [, , , , , , , spender] = await ethers.getSigners();

    await time.increaseTo(w.start);
    await vest["release(address)"](tokenAddr); // give exchange some liquid balance
    const owner = signers.exchange;

    const value = 1_000n * E18;
    const deadline = (await time.latest()) + 3600;
    const nonce = await token.nonces(owner.address);
    const domain = {
      name: "apM Fashion",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: tokenAddr,
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
