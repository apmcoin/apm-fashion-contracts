import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";

export const ROOT_DIR = path.resolve(__dirname, "..", "..");
export const TOKENOMICS_PATH = path.join(ROOT_DIR, "config", "tokenomics.json");
export const RECIPIENTS_PATH = path.join(ROOT_DIR, "config", "recipients.json");

const BASIS_POINTS = 10_000n;
const CONTRACT_TOTAL_SUPPLY_WEI = 10_000_000_000n * 10n ** 18n;

export interface TokenomicsPool {
  id: string;
  name: string;
  shareBps: number;
}

export interface TokenomicsConfig {
  schemaVersion: number;
  token: {
    name: string;
    symbol: string;
    decimals: number;
    totalSupplyTokens: string;
  };
  pools: TokenomicsPool[];
}

export interface AllocationEntry extends TokenomicsPool {
  amountTokens: string;
  amountWei: string;
}

export interface AllocationArtifact {
  policyHash: string;
  totalSupplyWei: string;
  allocations: AllocationEntry[];
}

export interface RecipientNetwork {
  chainId: number;
  recipients: Record<string, string | null>;
}

export interface DeploymentAllocation extends AllocationEntry {
  recipient: string;
}

export interface DeploymentPlan {
  schemaVersion: number;
  contract: "ApmFashion";
  network: string;
  chainId: number;
  policyHash: string;
  recipientsHash: string;
  totalSupplyWei: string;
  allocations: DeploymentAllocation[];
  constructorArgs: {
    recipients: string[];
    amounts: string[];
  };
  planHash: string;
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`)
    .join(",")}}`;
}

function hashValue(value: unknown): string {
  return `sha256:${crypto.createHash("sha256").update(canonicalStringify(value)).digest("hex")}`;
}

function formatTokens(amountWei: bigint, decimals: number): string {
  return ethers.formatUnits(amountWei, decimals).replace(/\.0$/, "");
}

export function loadTokenomics(): TokenomicsConfig {
  const raw = asRecord(readJson(TOKENOMICS_PATH), "tokenomics");
  if (raw.schemaVersion !== 1) throw new Error("Unsupported tokenomics schemaVersion");

  const token = asRecord(raw.token, "tokenomics.token");
  if (token.name !== "apM Fashion" || token.symbol !== "APM") {
    throw new Error("Token metadata does not match ApmFashion");
  }
  if (token.decimals !== 18 || token.totalSupplyTokens !== "10000000000") {
    throw new Error("Token supply does not match the audited ApmFashion contract");
  }
  if (!Array.isArray(raw.pools) || raw.pools.length !== 6) {
    throw new Error("Tokenomics must contain exactly six pools");
  }

  const ids = new Set<string>();
  const names = new Set<string>();
  let totalBps = 0;
  const pools = raw.pools.map((value, index) => {
    const pool = asRecord(value, `tokenomics.pools[${index}]`);
    if (typeof pool.id !== "string" || !/^[a-z][a-z0-9_]*$/.test(pool.id)) {
      throw new Error(`Invalid pool id at index ${index}`);
    }
    if (typeof pool.name !== "string" || pool.name.length === 0) {
      throw new Error(`Invalid pool name at index ${index}`);
    }
    if (!Number.isInteger(pool.shareBps) || (pool.shareBps as number) <= 0) {
      throw new Error(`Invalid shareBps for ${pool.id}`);
    }
    if (ids.has(pool.id) || names.has(pool.name)) throw new Error(`Duplicate pool: ${pool.id}`);
    ids.add(pool.id);
    names.add(pool.name);
    totalBps += pool.shareBps as number;
    return { id: pool.id, name: pool.name, shareBps: pool.shareBps as number };
  });
  if (totalBps !== Number(BASIS_POINTS)) throw new Error(`Pool shares total ${totalBps}, expected 10000`);

  return {
    schemaVersion: 1,
    token: {
      name: token.name as string,
      symbol: token.symbol as string,
      decimals: token.decimals as number,
      totalSupplyTokens: token.totalSupplyTokens as string,
    },
    pools,
  };
}

export function buildAllocationArtifact(): AllocationArtifact {
  const policy = loadTokenomics();
  const totalSupplyWei = BigInt(policy.token.totalSupplyTokens) * 10n ** BigInt(policy.token.decimals);
  if (totalSupplyWei !== CONTRACT_TOTAL_SUPPLY_WEI) throw new Error("TOTAL_SUPPLY mismatch");

  const allocations = policy.pools.map((pool) => {
    const numerator = totalSupplyWei * BigInt(pool.shareBps);
    if (numerator % BASIS_POINTS !== 0n) throw new Error(`Non-integral allocation for ${pool.id}`);
    const amountWei = numerator / BASIS_POINTS;
    return {
      ...pool,
      amountTokens: formatTokens(amountWei, policy.token.decimals),
      amountWei: amountWei.toString(),
    };
  });
  const sum = allocations.reduce((total, allocation) => total + BigInt(allocation.amountWei), 0n);
  if (sum !== totalSupplyWei) throw new Error("Allocation checksum failed");

  return {
    policyHash: hashValue(policy),
    totalSupplyWei: totalSupplyWei.toString(),
    allocations,
  };
}

export function buildDeploymentPlan(
  artifact: AllocationArtifact,
  networkName: string,
  network: RecipientNetwork
): DeploymentPlan {
  if (!Number.isInteger(network.chainId) || network.chainId <= 0) throw new Error("Invalid recipient chainId");
  const expectedIds = artifact.allocations.map((allocation) => allocation.id);
  const actualIds = Object.keys(network.recipients);
  const missing = expectedIds.filter((id) => !(id in network.recipients));
  const extra = actualIds.filter((id) => !expectedIds.includes(id));
  if (missing.length || extra.length) {
    throw new Error(`Recipient pool mismatch; missing=[${missing.join(",")}], extra=[${extra.join(",")}]`);
  }

  const seen = new Set<string>();
  const allocations = artifact.allocations.map((allocation) => {
    const configured = network.recipients[allocation.id];
    if (typeof configured !== "string" || configured.length === 0) {
      throw new Error(`Missing recipient for ${allocation.id}`);
    }
    if (!ethers.isAddress(configured)) throw new Error(`Invalid recipient for ${allocation.id}: ${configured}`);
    const recipient = ethers.getAddress(configured);
    if (recipient === ethers.ZeroAddress) throw new Error(`Zero recipient for ${allocation.id}`);
    const key = recipient.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate recipient: ${recipient}`);
    seen.add(key);
    return { ...allocation, recipient };
  });

  const base = {
    schemaVersion: 1,
    contract: "ApmFashion" as const,
    network: networkName,
    chainId: network.chainId,
    policyHash: artifact.policyHash,
    recipientsHash: hashValue(network),
    totalSupplyWei: artifact.totalSupplyWei,
    allocations,
    constructorArgs: {
      recipients: allocations.map((allocation) => allocation.recipient),
      amounts: allocations.map((allocation) => allocation.amountWei),
    },
  };
  return { ...base, planHash: hashValue(base) };
}

export function createDeploymentPlan(networkName: string): DeploymentPlan {
  const raw = asRecord(readJson(RECIPIENTS_PATH), "recipients");
  if (raw.schemaVersion !== 1) throw new Error("Unsupported recipients schemaVersion");
  const networks = asRecord(raw.networks, "recipients.networks");
  const networkRaw = asRecord(networks[networkName], `recipients.networks.${networkName}`);
  const recipientsRaw = asRecord(networkRaw.recipients, `recipients.networks.${networkName}.recipients`);
  const network: RecipientNetwork = {
    chainId: networkRaw.chainId as number,
    recipients: Object.fromEntries(Object.entries(recipientsRaw).map(([id, value]) => [id, value as string | null])),
  };
  return buildDeploymentPlan(buildAllocationArtifact(), networkName, network);
}

export function deploymentPlanPath(networkName: string): string {
  return path.join(ROOT_DIR, "config", `deployment-plan.${networkName}.json`);
}

export function assertPlanHash(plan: DeploymentPlan): void {
  const { planHash, ...base } = plan;
  const expected = hashValue(base);
  if (planHash !== expected) throw new Error(`Deployment plan hash mismatch: ${planHash} != ${expected}`);
}

export function loadApprovedDeploymentPlan(networkName: string): DeploymentPlan {
  const filePath = deploymentPlanPath(networkName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing approved deployment plan: ${path.relative(ROOT_DIR, filePath)}`);
  }
  const stored = readJson(filePath) as DeploymentPlan;
  assertPlanHash(stored);
  const expected = createDeploymentPlan(networkName);
  if (canonicalStringify(stored) !== canonicalStringify(expected)) {
    throw new Error("Approved deployment plan is stale; regenerate and review it before deployment");
  }
  return stored;
}
