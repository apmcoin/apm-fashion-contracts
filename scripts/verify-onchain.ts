import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { Contract, getAddress, getCreateAddress, JsonRpcProvider, ZeroAddress } from "ethers";
import { connectRpc, contractFactory, Network, networkSettings, TOTAL_SUPPLY } from "./lib/deployment";
import type { GenesisArguments } from "./lib/genesis";

interface DeploymentIdentity {
  network: Network;
  chainId: number;
  deployer: string;
  contractAddress: string;
  transactionHash: string;
}

export type DeploymentRecord = DeploymentIdentity & (
  { contract?: "ApmFashion"; recipient: string } |
  { contract: "GenesisClaim"; constructorArguments: GenesisArguments }
);

export async function verifyDeployment(record: DeploymentRecord, provider: JsonRpcProvider) {
  const { chainId } = networkSettings(record.network);
  assert.equal(record.chainId, chainId, "Record chain mismatch");
  assert.equal((await provider.getNetwork()).chainId, BigInt(chainId), "RPC chain mismatch");
  const receipt = await provider.getTransactionReceipt(record.transactionHash);
  const transaction = await provider.getTransaction(record.transactionHash);
  assert(receipt && transaction, "Deployment transaction not found");
  assert.equal(receipt.status, 1, "Deployment reverted");
  const address = getAddress(record.contractAddress);
  assert.equal(transaction.chainId, BigInt(chainId), "Transaction chain mismatch");
  assert.equal(transaction.from, getAddress(record.deployer), "Deployer mismatch");
  assert.equal(transaction.to, null, "Not a deployment transaction");
  assert.equal(transaction.value, 0n, "Unexpected native value");
  assert.equal(receipt.contractAddress, address, "Contract address mismatch");
  assert.equal(getCreateAddress({ from: transaction.from, nonce: transaction.nonce }), address);
  const factory = contractFactory(record.contract ?? "ApmFashion");
  const supply = TOTAL_SUPPLY;
  const expected = record.contract === "GenesisClaim"
    ? await factory.getDeployTransaction(...record.constructorArguments)
    : await factory.getDeployTransaction([getAddress(record.recipient)], [supply]);
  assert.equal(transaction.data, expected.data, "Deployment bytecode or constructor arguments mismatch");
  assert.notEqual(await provider.getCode(address), "0x", "Missing deployed code");
  const token = new Contract(address, factory.interface, provider);
  if (record.contract === "GenesisClaim") {
    const [asset, root, start, ends, allocation] = record.constructorArguments;
    assert.equal(await token.token(), getAddress(asset));
    assert.equal(await token.merkleRoot(), root);
    assert.equal(await token.startTimestamp(), BigInt(start));
    assert.equal(await token.totalAllocation(), BigInt(allocation));
    assert.equal(ends.length, 36);
    for (let round = 0; round < ends.length; ++round) {
      assert.equal(await token.roundEndTimestamps(round), BigInt(ends[round]));
    }
    console.log(`Verified GenesisClaim ${address} at deployment block ${receipt.blockNumber}`);
    return;
  }
  const recipient = getAddress(record.recipient);
  assert.equal(await token.name(), "apM Fashion");
  assert.equal(await token.symbol(), "APM");
  assert.equal(await token.decimals(), 18n);
  assert.equal(await token.TOTAL_SUPPLY(), supply);
  assert.equal(await token.totalSupply(), supply);
  const mints = receipt.logs.filter((log) => log.address.toLowerCase() === address.toLowerCase())
    .map((log) => factory.interface.parseLog({ topics: [...log.topics], data: log.data }))
    .filter((log) => log?.name === "Transfer" && log.args[0] === ZeroAddress);
  assert.equal(mints.length, 1, "Expected one initial mint");
  assert.equal(mints[0]!.args[1], recipient, "Initial recipient mismatch");
  assert.equal(mints[0]!.args[2], supply, "Initial mint amount mismatch");
  console.log(`Verified ${address} at deployment block ${receipt.blockNumber}`);
  console.log(`Recipient current balance: ${await token.balanceOf(recipient)}`);
}

if (require.main === module) {
  (async () => {
    if (!process.argv[2]) throw new Error("Usage: npm run verify:onchain -- <deployment-record.json>");
    const record: DeploymentRecord = JSON.parse(readFileSync(process.argv[2], "utf8"));
    const provider = await connectRpc(record.network);
    try { await verifyDeployment(record, provider); }
    finally { provider.destroy(); }
  })().catch((error) => { console.error(error.message ?? error); process.exitCode = 1; });
}
