import { ethers, network } from "hardhat";

/**
 * apM Fashion deployment - a single transaction.
 *
 * Every allocation pool is minted into its own OpenZeppelin VestingWallet, deployed by the token
 * constructor. Schedules are written in human terms (cliff months + linear months) and converted
 * to exact calendar timestamps here - no 30-day approximation (handles 28-31 day months & leap
 * years). A pool that must be liquid at TGE uses 0 cliff + 0 linear (duration 0 at TGE).
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

/** Add calendar months to a UNIX timestamp (UTC; clamps end-of-month, handles leap years). */
function addMonths(unixSeconds: number, months: number): number {
  const d = new Date(unixSeconds * 1000);
  d.setUTCMonth(d.getUTCMonth() + months);
  return Math.floor(d.getTime() / 1000);
}

function fmt(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Network: ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);

  // ----- TODO: replace with real pool cold-wallet addresses -----
  const POOLS = [
    { name: "Genesis Airdrop", addr: "0x0000000000000000000000000000000000000001", pct: 4_400_000_000n, cliffMonths: 0, linearMonths: 24 },
    { name: "Foundation",      addr: "0x0000000000000000000000000000000000000002", pct: 2_100_000_000n, cliffMonths: 0, linearMonths: 24 },
    { name: "Team",            addr: "0x0000000000000000000000000000000000000003", pct: 1_000_000_000n, cliffMonths: 12, linearMonths: 24 },
    { name: "Rewards",         addr: "0x0000000000000000000000000000000000000004", pct: 1_500_000_000n, cliffMonths: 6, linearMonths: 0 },
    { name: "Investors",       addr: "0x0000000000000000000000000000000000000005", pct: 500_000_000n, cliffMonths: 6, linearMonths: 18 },
    { name: "Exchange Airdrop", addr: "0x0000000000000000000000000000000000000006", pct: 500_000_000n, cliffMonths: 0, linearMonths: 0 },
  ];

  // TGE: set TGE_ISO (e.g. "2026-07-01T00:00:00Z") for the real launch; else deploy + 1 day.
  const nowSec = Math.floor(Date.now() / 1000);
  const TGE = process.env.TGE_ISO ? Math.floor(Date.parse(process.env.TGE_ISO) / 1000) : nowSec + DAY;
  if (!Number.isFinite(TGE)) throw new Error(`invalid TGE_ISO: ${process.env.TGE_ISO}`);
  if (TGE < nowSec) throw new Error(`TGE ${fmt(TGE)} is in the past`);
  console.log(`TGE: ${fmt(TGE)}`);

  const beneficiaries: string[] = [];
  const amounts: bigint[] = [];
  const starts: number[] = [];
  const durations: number[] = [];

  for (const p of POOLS) {
    const start = addMonths(TGE, p.cliffMonths); // cliff = start offset from TGE
    const end = addMonths(start, p.linearMonths); // linear runs for N calendar months after cliff
    const duration = end - start; // exact seconds (0 when linearMonths == 0)
    beneficiaries.push(p.addr);
    amounts.push(p.pct * E18);
    starts.push(start);
    durations.push(duration);
    console.log(
      `  ${p.name.padEnd(16)} ${p.pct} APM  start=${fmt(start)}  end=${fmt(end)}  dur=${duration}s`
    );
  }

  const sum = amounts.reduce((a, b) => a + b, 0n);
  if (sum !== TOTAL) throw new Error(`allocation sum ${sum} != TOTAL_SUPPLY ${TOTAL}`);

  const Token = await ethers.getContractFactory("ApmFashion");
  const token = await Token.deploy(beneficiaries, amounts, starts, durations);
  await token.waitForDeployment();

  console.log(`\nApmFashion: ${await token.getAddress()}`);
  const events = await token.queryFilter(token.filters.VestingDeployed());
  for (const e of events) {
    console.log(`  pool ${e.args.beneficiary} -> vesting ${e.args.wallet} (${e.args.amount})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
