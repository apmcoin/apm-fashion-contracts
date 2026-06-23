import { ethers, network } from "hardhat";

/**
 * apM Fashion deployment - a single transaction.
 *
 * Every allocation pool is minted into its own OpenZeppelin VestingWallet, deployed by the
 * token constructor. There is no separate "free" bucket: a pool that must be liquid at TGE
 * simply uses duration 0 (fully releasable at its start).
 *
 * Schedules use (start, duration):
 *   pure linear:       start = TGE,         duration = period
 *   cliff + linear:    start = TGE + cliff, duration = period
 *   pure cliff (full): start = TGE + cliff, duration = 0
 *   liquid at TGE:     start = TGE,         duration = 0
 *
 * Distribution & release schedule (tentative - replace addresses/percentages with finals):
 *   Genesis Airdrop    44%  24mo linear                (existing community succession)
 *   Foundation Reserve 21%  24mo linear
 *   Team               10%  12mo cliff + 24mo linear
 *   Rewards Pool       15%  6mo cliff (full unlock)
 *   Investors          5%   6mo cliff + 18mo linear
 *   Exchange Airdrop   5%   liquid at TGE (released only if required for listing)
 */

const E18 = 10n ** 18n;
const TOTAL = 10_000_000_000n * E18;
const DAY = 24 * 60 * 60;
const MONTH = 30 * DAY; // NOTE: 30-day approximation; switch to calendar dates for the real TGE

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Network: ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);

  // ----- TODO: replace with real pool cold-wallet addresses -----
  const GENESIS_AIRDROP = "0x0000000000000000000000000000000000000001";
  const FOUNDATION = "0x0000000000000000000000000000000000000002";
  const TEAM = "0x0000000000000000000000000000000000000003";
  const REWARDS = "0x0000000000000000000000000000000000000004";
  const INVESTORS = "0x0000000000000000000000000000000000000005";
  const EXCHANGE = "0x0000000000000000000000000000000000000006";

  const TGE = Math.floor(Date.now() / 1000) + 1 * DAY; // TGE = deploy + 1 day

  const beneficiaries = [GENESIS_AIRDROP, FOUNDATION, TEAM, REWARDS, INVESTORS, EXCHANGE];
  const amounts = [
    4_400_000_000n * E18, // 44%
    2_100_000_000n * E18, // 21%
    1_000_000_000n * E18, // 10%
    1_500_000_000n * E18, // 15%
    500_000_000n * E18, //  5%
    500_000_000n * E18, //  5%
  ];
  const starts = [
    TGE, //              Genesis
    TGE, //              Foundation
    TGE + 12 * MONTH, // Team (12mo cliff)
    TGE + 6 * MONTH, //  Rewards (6mo cliff)
    TGE + 6 * MONTH, //  Investors (6mo cliff)
    TGE, //              Exchange (liquid at TGE)
  ];
  const durations = [
    24 * MONTH, // Genesis
    24 * MONTH, // Foundation
    24 * MONTH, // Team
    0, //          Rewards (full unlock at cliff)
    18 * MONTH, // Investors
    0, //          Exchange (full unlock at TGE)
  ];

  const sum = amounts.reduce((a, b) => a + b, 0n);
  if (sum !== TOTAL) throw new Error(`allocation sum ${sum} != TOTAL_SUPPLY ${TOTAL}`);

  const Token = await ethers.getContractFactory("ApmFashion");
  const token = await Token.deploy(beneficiaries, amounts, starts, durations);
  await token.waitForDeployment();

  console.log(`ApmFashion: ${await token.getAddress()}`);
  const events = await token.queryFilter(token.filters.VestingDeployed());
  for (const e of events) {
    console.log(`  pool ${e.args.beneficiary} -> vesting ${e.args.wallet} (${e.args.amount})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
