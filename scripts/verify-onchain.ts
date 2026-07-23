import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";
import { assertPlanHash, DeploymentPlan } from "./lib/allocation-plan";

interface DeploymentRecord {
  schemaVersion: number;
  plan: DeploymentPlan;
  contractAddress: string;
  transactionHash: string;
  blockNumber: number;
  runtimeBytecodeHash: string;
}

const recordPath = process.argv[2];
if (!recordPath) {
  throw new Error("Usage: ts-node scripts/verify-onchain.ts <deployment-record.json>");
}

const record = JSON.parse(fs.readFileSync(path.resolve(recordPath), "utf8")) as DeploymentRecord;
if (record.schemaVersion !== 1) throw new Error("Unsupported deployment record schemaVersion");
assertPlanHash(record.plan);

function rpcFor(networkName: string): string {
  if (networkName === "bsc") {
    return process.env.BSC_RPC ?? "https://bsc-dataseed.bnbchain.org";
  }
  if (networkName === "bscTestnet") {
    return process.env.BSC_TESTNET_RPC ?? "https://data-seed-prebsc-1-s1.bnbchain.org:8545";
  }
  throw new Error(`Unsupported deployment network: ${networkName}`);
}

const TOKEN_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function TOTAL_SUPPLY() view returns (uint256)",
  "function owner() view returns (address)",
];

async function main() {
  const provider = new ethers.JsonRpcProvider(rpcFor(record.plan.network));
  const providerNetwork = await provider.getNetwork();
  if (providerNetwork.chainId !== BigInt(record.plan.chainId)) {
    throw new Error(`Connected chain ${providerNetwork.chainId} != record chain ${record.plan.chainId}`);
  }

  const address = ethers.getAddress(record.contractAddress);
  const token = new ethers.Contract(address, TOKEN_ABI, provider);
  const receipt = await provider.getTransactionReceipt(record.transactionHash);
  if (!receipt) throw new Error(`Deployment receipt not found: ${record.transactionHash}`);
  if (receipt.contractAddress?.toLowerCase() !== address.toLowerCase()) {
    throw new Error(`Receipt contract ${receipt.contractAddress} != record contract ${address}`);
  }
  if (receipt.blockNumber !== record.blockNumber) throw new Error("Deployment block number mismatch");

  let ok = true;
  const name: string = await token.name();
  const symbol: string = await token.symbol();
  const decimals: bigint = await token.decimals();
  const totalSupply: bigint = await token.totalSupply();
  const totalSupplyConstant: bigint = await token.TOTAL_SUPPLY();

  if (name !== "apM Fashion") { console.error("FAIL name"); ok = false; }
  if (symbol !== "APM") { console.error("FAIL symbol"); ok = false; }
  if (Number(decimals) !== 18) { console.error("FAIL decimals"); ok = false; }
  if (totalSupply !== BigInt(record.plan.totalSupplyWei)) { console.error("FAIL totalSupply"); ok = false; }
  if (totalSupplyConstant !== BigInt(record.plan.totalSupplyWei)) {
    console.error("FAIL TOTAL_SUPPLY");
    ok = false;
  }

  const runtimeCode = await provider.getCode(address);
  if (ethers.keccak256(runtimeCode) !== record.runtimeBytecodeHash) {
    console.error("FAIL runtime bytecode hash");
    ok = false;
  }

  try {
    await token.owner();
    console.error("FAIL ownerless: owner() did not revert");
    ok = false;
  } catch {
    console.log("[ok] ownerless");
  }

  const transferInterface = new ethers.Interface(TOKEN_ABI);
  const minted = new Map<string, bigint>();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== address.toLowerCase()) continue;
    try {
      const parsed = transferInterface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name !== "Transfer" || parsed.args[0] !== ethers.ZeroAddress) continue;
      const recipient = (parsed.args[1] as string).toLowerCase();
      minted.set(recipient, (minted.get(recipient) ?? 0n) + (parsed.args[2] as bigint));
    } catch {
      // Ignore non-Transfer logs from the token contract.
    }
  }

  for (const allocation of record.plan.allocations) {
    const actual = minted.get(allocation.recipient.toLowerCase()) ?? 0n;
    const expected = BigInt(allocation.amountWei);
    if (actual !== expected) {
      console.error(`FAIL initial mint ${allocation.name}: ${actual} != ${expected}`);
      ok = false;
    } else {
      const currentBalance: bigint = await token.balanceOf(allocation.recipient);
      console.log(`[ok] ${allocation.name}: minted=${actual}, currentBalance=${currentBalance}`);
    }
  }

  console.log(ok ? "ALL CHECKS PASSED" : "ONE OR MORE CHECKS FAILED");
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
