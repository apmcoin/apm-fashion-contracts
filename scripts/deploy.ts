import { ethers, network } from "hardhat";

/**
 * apM Fashion deployment - a single transaction.
 *
 * ApmFashion's constructor deploys one OpenZeppelin VestingWallet per locked tranche and mints
 * into it, then mints the free tranches directly. The whole genesis is one deploy of one contract.
 *
 * Schedules use (start, duration):
 *   pure linear:        start = TGE,         duration = period
 *   cliff + linear:     start = TGE + cliff, duration = period
 *   pure cliff (full):  start = TGE + cliff, duration = 0
 *
 * Distribution & release schedule (tentative - replace addresses/percentages with finals):
 *   Genesis Airdrop    44%  24mo linear                (existing community succession)
 *   Foundation Reserve 21%  24mo linear
 *   Team               10%  12mo cliff + 24mo linear
 *   Rewards Pool       15%  6mo cliff (full unlock)
 *   Investors          5%   6mo cliff + 18mo linear
 *   Exchange Airdrop   5%   free (released only if required for listing)
 */

const E18 = 10n ** 18n;
const TOTAL = 10_000_000_000n * E18;
const DAY = 24 * 60 * 60;
const MONTH = 30 * DAY;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Network: ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);

  // ----- TODO: replace with real cold-wallet addresses -----
  const GENESIS_AIRDROP_COLD = "0x0000000000000000000000000000000000000001";
  const FOUNDATION_COLD = "0x0000000000000000000000000000000000000002";
  const TEAM_COLD = "0x0000000000000000000000000000000000000003";
  const REWARDS_COLD = "0x0000000000000000000000000000000000000004";
  const INVESTORS_COLD = "0x0000000000000000000000000000000000000005";
  const EXCHANGE_COLD = "0x0000000000000000000000000000000000000006";

  const TGE = Math.floor(Date.now() / 1000) + 1 * DAY; // TGE = deploy + 1 day

  // Locked tranches: (beneficiary, amount, start, duration)
  const lockBeneficiaries = [
    GENESIS_AIRDROP_COLD,
    FOUNDATION_COLD,
    TEAM_COLD,
    REWARDS_COLD,
    INVESTORS_COLD,
  ];
  const lockAmounts = [
    4_400_000_000n * E18, // 44%
    2_100_000_000n * E18, // 21%
    1_000_000_000n * E18, // 10%
    1_500_000_000n * E18, // 15%
    500_000_000n * E18, //  5%
  ];
  const lockStarts = [
    TGE, //              Genesis: linear from TGE
    TGE, //              Foundation: linear from TGE
    TGE + 12 * MONTH, // Team: 12mo cliff
    TGE + 6 * MONTH, //  Rewards: 6mo cliff
    TGE + 6 * MONTH, //  Investors: 6mo cliff
  ];
  const lockDurations = [
    24 * MONTH, // Genesis
    24 * MONTH, // Foundation
    24 * MONTH, // Team (after cliff)
    0, //          Rewards (full unlock at cliff)
    18 * MONTH, // Investors (after cliff)
  ];

  // Free tranches: (recipient, amount)
  const freeRecipients = [EXCHANGE_COLD];
  const freeAmounts = [500_000_000n * E18]; // 5%

  const sum =
    [...lockAmounts, ...freeAmounts].reduce((a, b) => a + b, 0n);
  if (sum !== TOTAL) throw new Error(`allocation sum ${sum} != TOTAL_SUPPLY ${TOTAL}`);

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

  console.log(`ApmFashion: ${await token.getAddress()}`);
  const events = await token.queryFilter(token.filters.VestingDeployed());
  for (const e of events) {
    console.log(`  vesting ${e.args.wallet} <- beneficiary ${e.args.beneficiary} (${e.args.amount})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
