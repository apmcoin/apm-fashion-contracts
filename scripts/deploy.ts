import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * apM Fashion deployment - a single transaction.
 *
 * Allocations live in a CSV (default: config/allocations.example.csv; override with env
 * ALLOCATIONS). Columns: pool,address,amount,cliffMonths,linearMonths
 *   - amount         : whole tokens (authoritative; sum must equal 10,000,000,000)
 *   - cliffMonths    : months before vesting starts (start = TGE + cliff)
 *   - linearMonths   : linear release months after the cliff (0 => full unlock at start)
 *
 * Schedules are converted to exact calendar timestamps (no 30-day approximation).
 * A pool liquid at TGE uses cliffMonths=0, linearMonths=0.
 */

const E18 = 10n ** 18n;
const TOTAL_TOKENS = 10_000_000_000n;
const TOTAL = TOTAL_TOKENS * E18;
const DAY = 24 * 60 * 60;

interface Pool {
  pool: string;
  address: string;
  amount: bigint; // whole tokens
  cliffMonths: number;
  linearMonths: number;
  row: number;
}

/** Add calendar months to a UNIX timestamp (UTC; handles 28-31 day months & leap years). */
function addMonths(unixSeconds: number, months: number): number {
  const d = new Date(unixSeconds * 1000);
  d.setUTCMonth(d.getUTCMonth() + months);
  return Math.floor(d.getTime() / 1000);
}

function fmt(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

function loadAllocations(file: string): Pool[] {
  const lines = fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  if (lines.length < 2) throw new Error(`allocations file has no data rows: ${file}`);

  const header = lines.shift()!.toLowerCase().replace(/\s/g, "");
  if (header !== "pool,address,amount,cliffmonths,linearmonths") {
    throw new Error(`unexpected CSV header: "${header}"`);
  }

  return lines.map((line, i) => {
    const parts = line.split(",").map((s) => s.trim());
    if (parts.length !== 5) throw new Error(`row ${i + 2}: expected 5 columns, got ${parts.length}`);
    return {
      pool: parts[0],
      address: parts[1],
      amount: BigInt(parts[2]),
      cliffMonths: Number(parts[3]),
      linearMonths: Number(parts[4]),
      row: i + 2,
    };
  });
}

function validate(pools: Pool[]): void {
  if (pools.length === 0) throw new Error("no pools");
  const seen = new Set<string>();
  let sum = 0n;
  for (const p of pools) {
    if (!ethers.isAddress(p.address)) throw new Error(`row ${p.row} (${p.pool}): invalid address ${p.address}`);
    const a = ethers.getAddress(p.address); // checksum
    if (a === ethers.ZeroAddress) throw new Error(`row ${p.row} (${p.pool}): zero address`);
    if (seen.has(a)) throw new Error(`row ${p.row} (${p.pool}): duplicate address ${a}`);
    seen.add(a);
    if (p.amount <= 0n) throw new Error(`row ${p.row} (${p.pool}): amount must be > 0`);
    if (!Number.isInteger(p.cliffMonths) || p.cliffMonths < 0) throw new Error(`row ${p.row} (${p.pool}): bad cliffMonths`);
    if (!Number.isInteger(p.linearMonths) || p.linearMonths < 0) throw new Error(`row ${p.row} (${p.pool}): bad linearMonths`);
    sum += p.amount;
  }
  if (sum !== TOTAL_TOKENS) throw new Error(`allocation sum ${sum} tokens != TOTAL_SUPPLY ${TOTAL_TOKENS}`);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Network: ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);

  const file = process.env.ALLOCATIONS || path.join("config", "allocations.example.csv");
  console.log(`Allocations: ${file}`);
  const pools = loadAllocations(file);
  validate(pools);

  const nowSec = Math.floor(Date.now() / 1000);
  const TGE = process.env.TGE_ISO ? Math.floor(Date.parse(process.env.TGE_ISO) / 1000) : nowSec + DAY;
  if (!Number.isFinite(TGE)) throw new Error(`invalid TGE_ISO: ${process.env.TGE_ISO}`);
  if (TGE < nowSec) throw new Error(`TGE ${fmt(TGE)} is in the past`);
  console.log(`TGE: ${fmt(TGE)}\n`);

  const beneficiaries: string[] = [];
  const amounts: bigint[] = [];
  const starts: number[] = [];
  const durations: number[] = [];

  for (const p of pools) {
    const start = addMonths(TGE, p.cliffMonths);
    const end = addMonths(start, p.linearMonths);
    const duration = end - start;
    beneficiaries.push(ethers.getAddress(p.address));
    amounts.push(p.amount * E18);
    starts.push(start);
    durations.push(duration);
    const pct = (Number(p.amount) / Number(TOTAL_TOKENS)) * 100;
    console.log(
      `  ${p.pool.padEnd(18)} ${p.amount} (${pct.toFixed(1)}%)  start=${fmt(start)}  end=${fmt(end)}`
    );
  }

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
