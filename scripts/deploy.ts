import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * apM Fashion deployment (Model A).
 *
 * 1) Read + validate the allocations CSV.
 * 2) Deploy one stock OpenZeppelin VestingWallet per pool (out of audit scope).
 * 3) Deploy ApmFashion, minting the full supply directly into those vesting wallets.
 * 4) Post-verify on-chain state (balances, beneficiaries, schedules, total supply).
 *
 * CSV columns: pool,address,amount,cliffMonths,linearMonths
 *   amount = whole tokens (sum must equal 10,000,000,000)
 *   schedule: start = TGE + cliffMonths, duration = linearMonths (calendar-accurate; 0 = liquid)
 */

const E18 = 10n ** 18n;
const TOTAL_TOKENS = 10_000_000_000n;
const TOTAL = TOTAL_TOKENS * E18;
const DAY = 24 * 60 * 60;

interface Pool {
  pool: string;
  address: string;
  amount: bigint;
  cliffMonths: number;
  linearMonths: number;
  row: number;
}

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
    const a = ethers.getAddress(p.address);
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

  const schedule = pools.map((p) => {
    const start = addMonths(TGE, p.cliffMonths);
    const end = addMonths(start, p.linearMonths);
    return { ...p, address: ethers.getAddress(p.address), start, duration: end - start, amountWei: p.amount * E18 };
  });

  // 1) deploy a stock OZ VestingWallet per pool
  const Vest = await ethers.getContractFactory("VestingWallet");
  const wallets: string[] = [];
  for (const s of schedule) {
    const v = await Vest.deploy(s.address, s.start, s.duration);
    await v.waitForDeployment();
    const addr = await v.getAddress();
    wallets.push(addr);
    console.log(`  ${s.pool.padEnd(18)} vesting=${addr}  beneficiary=${s.address}  start=${fmt(s.start)}  dur=${s.duration}s`);
  }

  // 2) deploy token, minting directly into the vesting wallets
  const Token = await ethers.getContractFactory("ApmFashion");
  const token = await Token.deploy(wallets, schedule.map((s) => s.amountWei));
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log(`\nApmFashion: ${tokenAddr}`);

  // 3) post-verify
  console.log(`\nVerifying on-chain state...`);
  let ok = true;
  const total = await token.totalSupply();
  if (total !== TOTAL) {
    ok = false;
    console.error(`  [FAIL] totalSupply ${total} != ${TOTAL}`);
  }
  for (let i = 0; i < schedule.length; i++) {
    const s = schedule[i];
    const v = await ethers.getContractAt("VestingWallet", wallets[i]);
    const bal = await token.balanceOf(wallets[i]);
    const owner = ethers.getAddress(await v.owner());
    const vstart = Number(await v.start());
    const vdur = Number(await v.duration());
    const pass = bal === s.amountWei && owner === s.address && vstart === s.start && vdur === s.duration;
    if (!pass) {
      ok = false;
      console.error(`  [FAIL] ${s.pool}: bal=${bal} owner=${owner} start=${vstart} dur=${vdur}`);
    } else {
      console.log(`  [ok] ${s.pool}: ${bal / E18} APM -> ${owner}`);
    }
  }
  if (!ok) throw new Error("post-deploy verification FAILED");
  console.log("\nAll checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
