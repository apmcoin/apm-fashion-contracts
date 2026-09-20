import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { Contract, formatEther, getCreateAddress, keccak256, Transaction } from "ethers";
import { connectRpc, contractFactory, deployerSettings, ROOT } from "./lib/deployment";
import { genesisArguments } from "./lib/genesis";
import { signWithLedger } from "./lib/ledger";
import { DeploymentRecord, verifyDeployment } from "./verify-onchain";

async function main() {
  const { network, chainId, deployer } = deployerSettings(process.argv[2]);
  const constructorArguments = genesisArguments(network);
  const factory = contractFactory("GenesisClaim");
  const provider = await connectRpc(network);
  try {
    if (await provider.getCode(deployer) !== "0x") throw new Error("Deployer must be an EOA");
    const tokenAddress = constructorArguments[0];
    if (await provider.getCode(tokenAddress) === "0x") throw new Error("Missing Genesis token contract");
    const token = new Contract(tokenAddress, ["function decimals() view returns(uint8)"], provider);
    if (await token.decimals() !== 18n) throw new Error("Genesis token must use 18 decimals");
    const creation = await factory.getDeployTransaction(...constructorArguments);
    const nonce = await provider.getTransactionCount(deployer, "pending");
    if (nonce !== await provider.getTransactionCount(deployer, "latest")) throw new Error("Deployer has pending transactions");
    const gasPrice = (await provider.getFeeData()).gasPrice;
    if (gasPrice === null) throw new Error("Missing gas price");
    const gasLimit = (await provider.estimateGas({ ...creation, from: deployer })) * 120n / 100n;
    if (await provider.getBalance(deployer) < gasLimit * gasPrice) throw new Error("Insufficient native balance for gas");
    const transaction = Transaction.from({ type: 0, chainId, nonce, gasPrice, gasLimit, data: creation.data, value: 0n });
    const address = getCreateAddress({ from: deployer, nonce });
    console.log({ contract: "GenesisClaim", network, chainId, deployer, address, constructorArguments,
      gasToken: network === "sepolia" ? "ETH" : "BNB",
      maxGasCost: formatEther(gasLimit * gasPrice), dataHash: keccak256(creation.data!) });
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (await prompt.question("Type DEPLOY to request Ledger signing: ") !== "DEPLOY") return;
    } finally { prompt.close(); }
    const signed = await signWithLedger(transaction, deployer);
    const record: DeploymentRecord = { network, chainId, deployer, contract: "GenesisClaim", constructorArguments,
      contractAddress: address, transactionHash: keccak256(signed) };
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
