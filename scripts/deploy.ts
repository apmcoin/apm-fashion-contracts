import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { loadApprovedDeploymentPlan, ROOT_DIR } from "./lib/allocation-plan";

/**
 * apM Fashion deployment.
 *
 * Loads a reviewed deployment plan derived from tokenomics and recipient
 * configuration, deploys ApmFashion, verifies the initial state, and writes
 * an immutable deployment record for independent verification.
 *
 * Switching networks: npm run deploy:bscTestnet  /  npm run deploy:bsc
 */

async function main() {
  if (network.name !== "bsc" && network.name !== "bscTestnet") {
    throw new Error(`Unsupported deployment network: ${network.name}`);
  }
  if (network.name === "bsc" && !process.env.BSC_RPC) {
    throw new Error("BSC_RPC must be explicitly configured for mainnet deployment");
  }
  const plan = loadApprovedDeploymentPlan(network.name);
  const providerNetwork = await ethers.provider.getNetwork();
  if (providerNetwork.chainId !== BigInt(plan.chainId)) {
    throw new Error(`Connected chain ${providerNetwork.chainId} != plan chain ${plan.chainId}`);
  }

  const [deployer] = await ethers.getSigners();
  console.log(`Network  : ${network.name}`);
  console.log(`Chain ID : ${plan.chainId}`);
  console.log(`Deployer : ${deployer.address}`);
  console.log(`Plan hash: ${plan.planHash}`);

  if (network.name === "bsc") {
    for (const allocation of plan.allocations) {
      const code = await ethers.provider.getCode(allocation.recipient);
      if (code === "0x") throw new Error(`Mainnet recipient has no contract code: ${allocation.recipient}`);
    }
  }

  console.log("\nAllocation:");
  for (const allocation of plan.allocations) {
    console.log(
      `  ${allocation.name.padEnd(28)} ${allocation.recipient}  ${allocation.amountWei}`
    );
  }

  const Token = await ethers.getContractFactory("ApmFashion");
  const token = await Token.deploy(
    plan.constructorArgs.recipients,
    plan.constructorArgs.amounts.map(BigInt)
  );
  const deploymentTransaction = token.deploymentTransaction();
  if (!deploymentTransaction) throw new Error("Missing deployment transaction");
  const receipt = await deploymentTransaction.wait();
  if (!receipt) throw new Error("Missing deployment receipt");
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log(`\nApmFashion: ${tokenAddr}`);
  console.log(`Deploy tx : ${deploymentTransaction.hash}`);

  console.log("\nVerifying on-chain state...");
  let ok = true;
  const totalSupply = await token.totalSupply();
  if (totalSupply !== BigInt(plan.totalSupplyWei)) {
    ok = false;
    console.error(`  [FAIL] totalSupply ${totalSupply} != ${plan.totalSupplyWei}`);
  }
  for (const allocation of plan.allocations) {
    const balance = await token.balanceOf(allocation.recipient);
    const expected = BigInt(allocation.amountWei);
    if (balance !== expected) {
      ok = false;
      console.error(`  [FAIL] ${allocation.name}: ${balance} != ${expected}`);
    } else {
      console.log(`  [ok] ${allocation.name}: ${balance}`);
    }
  }
  if (!ok) throw new Error("post-deploy verification FAILED");

  const runtimeCode = await ethers.provider.getCode(tokenAddr);
  const deploymentRecord = {
    schemaVersion: 1,
    plan,
    contractAddress: tokenAddr,
    transactionHash: deploymentTransaction.hash,
    blockNumber: receipt.blockNumber,
    runtimeBytecodeHash: ethers.keccak256(runtimeCode),
  };
  const outputDirectory = path.join(ROOT_DIR, "deployments", String(plan.chainId));
  fs.mkdirSync(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, `${tokenAddr}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(deploymentRecord, null, 2)}\n`);

  console.log(`\nDeployment record: ${path.relative(ROOT_DIR, outputPath)}`);
  console.log("All checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
