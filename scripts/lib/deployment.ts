import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ContractFactory, FetchRequest, getAddress, JsonRpcProvider, ZeroAddress } from "ethers";

export const ROOT = resolve(__dirname, "../..");
const NETWORKS = { bsc: [56, "BSC_RPC"], sepolia: [11155111, "SEPOLIA_RPC"] } as const;
export type Network = keyof typeof NETWORKS;
type DeploymentConfig = Record<Network, { deployer: string | null }>;

export function networkSettings(network: string) {
  if (network !== "bsc" && network !== "sepolia") throw new Error("Use bsc or sepolia");
  const [chainId, rpcVariable] = NETWORKS[network];
  return { network, chainId, rpcVariable } as const;
}

export function deployerSettings(network: string, config?: DeploymentConfig) {
  const settings = networkSettings(network);
  const configured: DeploymentConfig = config ?? JSON.parse(readFileSync(resolve(ROOT, "config/deployment.json"), "utf8"));
  const entry = configured[settings.network];
  if (!entry?.deployer) throw new Error("Set deployer in config/deployment.json");
  const deployer = getAddress(entry.deployer);
  if (deployer === ZeroAddress) throw new Error("Use a nonzero deployer");
  return { ...settings, deployer };
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

export function contractFactory(name: "ApmFashion" | "GenesisClaim") {
  const artifact = JSON.parse(readFileSync(resolve(ROOT, `artifacts/contracts/${name}.sol/${name}.json`), "utf8"));
  return new ContractFactory(artifact.abi, artifact.bytecode);
}
