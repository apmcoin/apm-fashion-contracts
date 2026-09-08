import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { Contract, formatEther, getCreateAddress, keccak256, Transaction } from "ethers";
import { connectRpc, deploymentSettings, ROOT, tokenFactory, TOTAL_SUPPLY } from "./lib/deployment";
import { signWithLedger } from "./lib/ledger";
import { verifyDeployment } from "./verify-onchain";

async function main() {
  const { network, chainId, deployer, recipient } = deploymentSettings(process.argv[2]);
  const supply = TOTAL_SUPPLY;
  const provider = await connectRpc(network);
  try {
    if (await provider.getCode(deployer) !== "0x") throw new Error("Deployer must be an EOA");
    const safe = new Contract(recipient, ["function getOwners() view returns(address[])", "function getThreshold() view returns(uint256)"], provider);
    const owners: string[] = await safe.getOwners();
    const threshold: bigint = await safe.getThreshold();
    if (threshold < 2n || threshold > BigInt(owners.length)) throw new Error("Recipient must be a multisig Safe");
    const creation = await tokenFactory().getDeployTransaction([recipient], [supply]);
    const nonce = await provider.getTransactionCount(deployer, "pending");
    if (nonce !== await provider.getTransactionCount(deployer, "latest")) throw new Error("Deployer has pending transactions");
    const gasPrice = (await provider.getFeeData()).gasPrice;
    if (gasPrice === null) throw new Error("Missing gas price");
    const gasLimit = (await provider.estimateGas({ ...creation, from: deployer })) * 120n / 100n;
    if (await provider.getBalance(deployer) < gasLimit * gasPrice) throw new Error("Insufficient BNB for gas");
    const transaction = Transaction.from({ type: 0, chainId, nonce, gasPrice, gasLimit, data: creation.data, value: 0n });
    const address = getCreateAddress({ from: deployer, nonce });
    console.log({ network, chainId, deployer, recipient, owners, threshold: String(threshold),
      supply: formatEther(supply), address, maxGasBNB: formatEther(gasLimit * gasPrice), dataHash: keccak256(creation.data!) });
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (await prompt.question("Type DEPLOY to request Ledger signing: ") !== "DEPLOY") return;
    } finally { prompt.close(); }
    const signed = await signWithLedger(transaction, deployer);
    const record = { network, chainId, deployer, recipient, contractAddress: address, transactionHash: keccak256(signed) };
    const directory = join(ROOT, "deployments", String(chainId));
    mkdirSync(directory, { recursive: true });
    const output = join(directory, `${address}.json`);
    // Persist the signed transaction identity before broadcast, including on RPC failure.
    writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
    console.log(`Record: ${output}\nTransaction: ${record.transactionHash}`);
    const sent = await provider.broadcastTransaction(signed);
    const receipt = await sent.wait();
    if (!receipt || receipt.status !== 1) throw new Error("Deployment failed; inspect the recorded transaction before retrying");
    await verifyDeployment(record, provider);
  } finally { provider.destroy(); }
}

main().catch((error) => { console.error(error.message ?? error); process.exitCode = 1; });
