import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * apM Fashion deployment.
 *
 * Reads per-pool wei amounts from config/allocations-calc.json and
 * recipient Safe addresses from config/recipients.json, then deploys
 * ApmFashion minting the full supply directly into those addresses.
 * Post-verifies on-chain balances after deploy.
 *
 * Switching networks: npm run deploy:bscTestnet  /  npm run deploy:bsc
 */

const TOTAL = 10_000_000_000n * 10n ** 18n;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Network  : ${network.name}`);
  console.log(`Deployer : ${deployer.address}`);

  const calc = JSON.parse(fs.readFileSync(path.join("config", "allocations-calc.json"), "utf8"));
  const recipients: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join("config", "recipients.json"), "utf8")
  );

  const pools = (calc.allocations as Array<{ pool: string; amountWei: string }>).map((a) => {
    const address = recipients[a.pool];
    if (!address) throw new Error(`No address for pool: ${a.pool}`);
    if (!ethers.isAddress(address)) throw new Error(`Invalid address for pool ${a.pool}: ${address}`);
    return { pool: a.pool, address: ethers.getAddress(address), amountWei: BigInt(a.amountWei) };
  });

  const sum = pools.reduce((acc, p) => acc + p.amountWei, 0n);
  if (sum !== TOTAL) throw new Error(`Amount sum ${sum} != TOTAL_SUPPLY ${TOTAL}`);

  const seen = new Set<string>();
  for (const p of pools) {
    if (seen.has(p.address)) throw new Error(`Duplicate address: ${p.address}`);
    seen.add(p.address);
  }

  console.log("\nAllocation:");
  for (const p of pools) {
    console.log(`  ${p.pool.padEnd(22)} ${p.address}  ${p.amountWei}`);
  }

  const Token = await ethers.getContractFactory("ApmFashion");
  const token = await Token.deploy(
    pools.map((p) => p.address),
    pools.map((p) => p.amountWei)
  );
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log(`\nApmFashion: ${tokenAddr}`);

  console.log("\nVerifying on-chain state...");
  let ok = true;
  const totalSupply = await token.totalSupply();
  if (totalSupply !== TOTAL) {
    ok = false;
    console.error(`  [FAIL] totalSupply ${totalSupply} != ${TOTAL}`);
  }
  for (const p of pools) {
    const bal = await token.balanceOf(p.address);
    if (bal !== p.amountWei) {
      ok = false;
      console.error(`  [FAIL] ${p.pool}: ${bal} != ${p.amountWei}`);
    } else {
      console.log(`  [ok] ${p.pool}: ${bal}`);
    }
  }
  if (!ok) throw new Error("post-deploy verification FAILED");
  console.log("\nAll checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
