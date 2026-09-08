import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ContractFactory, FetchRequest, getAddress, JsonRpcProvider, ZeroAddress } from "ethers";

export const ROOT = resolve(__dirname, "../..");
export const TOTAL_SUPPLY = 10_000_000_000n * 10n ** 18n;
const NETWORKS = { bsc: [56, "BSC_RPC"], bscTestnet: [97, "BSC_TESTNET_RPC"] } as const;
export type Network = keyof typeof NETWORKS;
type DeploymentConfig = Record<Network, { deployer: string | null; recipient: string | null }>;

export function networkSettings(network: string) {
  if (network !== "bsc" && network !== "bscTestnet") throw new Error("Use bsc or bscTestnet");
  const [chainId, rpcVariable] = NETWORKS[network];
  return { network, chainId, rpcVariable };
}

export function deploymentSettings(network: string, config?: DeploymentConfig) {
  const settings = networkSettings(network);
  const configured: DeploymentConfig = config ?? JSON.parse(readFileSync(resolve(ROOT, "config/deployment.json"), "utf8"));
  const entry = configured[settings.network];
  if (!entry.deployer || !entry.recipient) throw new Error("Set deployer and recipient in config/deployment.json");
  const deployer = getAddress(entry.deployer);
  const recipient = getAddress(entry.recipient);
  if (deployer === ZeroAddress || recipient === ZeroAddress || deployer === recipient) {
    throw new Error("Use a nonzero deployer and a separate Safe recipient");
  }
  return { ...settings, deployer, recipient };
}

export async function connectRpc(network: string) {
  const { chainId, rpcVariable } = networkSettings(network);
  const url = process.env[rpcVariable];
  if (!url) throw new Error(`Set ${rpcVariable}`);
  const request = new FetchRequest(url);
  request.timeout = 20_000;
  const provider = new JsonRpcProvider(request, undefined, { batchMaxCount: 1 });
  try {
    if ((await provider.getNetwork()).chainId !== BigInt(chainId)) throw new Error("RPC chain mismatch");
    return provider;
  } catch (error) {
    provider.destroy();
    throw error;
  }
}

export function tokenFactory() {
  const artifact = JSON.parse(readFileSync(resolve(ROOT, "artifacts/contracts/ApmFashion.sol/ApmFashion.json"), "utf8"));
  return new ContractFactory(artifact.abi, artifact.bytecode);
}
