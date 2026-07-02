import * as dotenv from "dotenv";
dotenv.config();
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

const TOKEN   = process.argv[2] ?? (() => { throw new Error("Usage: npx ts-node scripts/verify-onchain.ts <token_address> [testnet|mainnet]"); })();
const NETWORK = process.argv[3] ?? "testnet";
const TOTAL = 10_000_000_000n * 10n ** 18n;

const ABI = [
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function TOTAL_SUPPLY() view returns (uint256)",
  "function owner() view returns (address)",
];

const calc: { allocations: Array<{ pool: string; amountWei: string }> } =
  JSON.parse(fs.readFileSync(path.join("config", "allocations-calc.json"), "utf8"));
const recipients: Record<string, string> =
  JSON.parse(fs.readFileSync(path.join("config", "recipients.json"), "utf8"));

const pools = calc.allocations.map((a) => {
  const address = recipients[a.pool];
  if (!address) throw new Error(`No address for pool: ${a.pool}`);
  return { pool: a.pool, address: ethers.getAddress(address), amountWei: BigInt(a.amountWei) };
});

async function main() {
  const rpc = NETWORK === "mainnet"
    ? (process.env.BSC_RPC ?? "https://bsc-rpc.publicnode.com")
    : (process.env.BSC_TESTNET_RPC ?? "https://bsc-testnet-rpc.publicnode.com");
  console.log(`Network : ${NETWORK}  RPC: ${rpc}`);
  const provider = new ethers.JsonRpcProvider(rpc);
  const token = new ethers.Contract(TOKEN, ABI, provider);

  let ok = true;

  const name     = await token.name();
  const symbol   = await token.symbol();
  const decimals = await token.decimals();
  const ts       = await token.totalSupply();
  const tsConst  = await token.TOTAL_SUPPLY();

  console.log(`name()         : ${name}`);
  console.log(`symbol()       : ${symbol}`);
  console.log(`decimals()     : ${decimals}`);
  console.log(`totalSupply()  : ${ts}`);
  console.log(`TOTAL_SUPPLY() : ${tsConst}`);
  console.log();

  if (name !== "apM Fashion")   { console.error("FAIL name");     ok = false; }
  if (symbol !== "APM")         { console.error("FAIL symbol");   ok = false; }
  if (Number(decimals) !== 18)  { console.error("FAIL decimals"); ok = false; }
  if (ts !== TOTAL)             { console.error(`FAIL totalSupply`); ok = false; }
  if (tsConst !== TOTAL)        { console.error(`FAIL TOTAL_SUPPLY`); ok = false; }

  try {
    await token.owner();
    console.error("FAIL ownerless: owner() did not revert");
    ok = false;
  } catch {
    console.log("owner()        : [reverts — ownerless confirmed]");
  }
  console.log();

  let sumBal = 0n;
  for (const p of pools) {
    const bal: bigint = await token.balanceOf(p.address);
    const pass = bal === p.amountWei;
    console.log(`[${pass ? "ok  " : "FAIL"}] ${p.pool.padEnd(22)} ${p.address}  ${bal}`);
    if (!pass) { console.error(`        expected: ${p.amountWei}`); ok = false; }
    sumBal += bal;
  }

  console.log();
  const sumPass = sumBal === TOTAL;
  console.log(`[${sumPass ? "ok  " : "FAIL"}] sum(balances) == TOTAL_SUPPLY : ${sumBal}`);
  if (!sumPass) ok = false;

  console.log();
  console.log(ok ? "ALL CHECKS PASSED" : "ONE OR MORE CHECKS FAILED");
  if (!ok) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
