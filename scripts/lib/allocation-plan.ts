import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";

export const ROOT_DIR = path.resolve(__dirname, "..", "..");
export const TOKENOMICS_PATH = path.join(ROOT_DIR, "config", "tokenomics.json");
export const RECIPIENTS_PATH = path.join(ROOT_DIR, "config", "recipients.json");

const CONTRACT_TOTAL_SUPPLY_WEI = 10_000_000_000n * 10n ** 18n;
const TOKEN_DECIMALS = 18n;

export interface TokenomicsPool {
  id: string;
  name: string;
  amountTokens: string;
}

export interface TokenomicsConfig {
  totalSupplyTokens: string;
  pools: TokenomicsPool[];
}

export interface AllocationEntry extends TokenomicsPool {
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

export function loadTokenomics(): TokenomicsConfig {
  const raw = asRecord(readJson(TOKENOMICS_PATH), "tokenomics");
  if (raw.totalSupplyTokens !== "10000000000") {
    throw new Error("Token supply does not match the audited ApmFashion contract");
  }
  if (!Array.isArray(raw.pools) || raw.pools.length !== 7) {
    throw new Error("Tokenomics must contain exactly seven pools");
  }

  const ids = new Set<string>();
  const names = new Set<string>();
  const pools = raw.pools.map((value, index) => {
    const pool = asRecord(value, `tokenomics.pools[${index}]`);
    if (typeof pool.id !== "string" || !/^[a-z][a-z0-9_]*$/.test(pool.id)) {
      throw new Error(`Invalid pool id at index ${index}`);
    }
    if (typeof pool.name !== "string" || pool.name.length === 0) {
      throw new Error(`Invalid pool name at index ${index}`);
    }
    if (typeof pool.amountTokens !== "string" || !/^[1-9][0-9]*$/.test(pool.amountTokens)) {
      throw new Error(`Invalid amountTokens for ${pool.id}`);
    }
    if (ids.has(pool.id) || names.has(pool.name)) throw new Error(`Duplicate pool: ${pool.id}`);
    ids.add(pool.id);
    names.add(pool.name);
    return { id: pool.id, name: pool.name, amountTokens: pool.amountTokens };
  });

  return {
    totalSupplyTokens: raw.totalSupplyTokens as string,
    pools,
  };
}

export function buildAllocationArtifact(): AllocationArtifact {
  const policy = loadTokenomics();
  const totalSupplyWei = BigInt(policy.totalSupplyTokens) * 10n ** TOKEN_DECIMALS;
  if (totalSupplyWei !== CONTRACT_TOTAL_SUPPLY_WEI) throw new Error("TOTAL_SUPPLY mismatch");

  const allocations = policy.pools.map((pool) => {
    const amountWei = BigInt(pool.amountTokens) * 10n ** TOKEN_DECIMALS;
    return {
      ...pool,
      amountWei: amountWei.toString(),
    };
  });
  const sum = allocations.reduce((total, allocation) => total + BigInt(allocation.amountWei), 0n);
  if (sum !== totalSupplyWei) throw new Error("Allocation total does not match total supply");

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

  const allocations = artifact.allocations.map((allocation) => {
    const configured = network.recipients[allocation.id];
    if (typeof configured !== "string" || configured.length === 0) {
      throw new Error(`Missing recipient for ${allocation.id}`);
    }
    if (!ethers.isAddress(configured)) throw new Error(`Invalid recipient for ${allocation.id}: ${configured}`);
    const recipient = ethers.getAddress(configured);
    if (recipient === ethers.ZeroAddress) throw new Error(`Zero recipient for ${allocation.id}`);
    return { ...allocation, recipient };
  });

  const recipientPools = new Map<string, string>();
  for (const allocation of allocations) {
    const key = allocation.recipient.toLowerCase();
    const existingPool = recipientPools.get(key);
    if (existingPool) {
      throw new Error(
        `Duplicate recipient for ${existingPool} and ${allocation.id}: ${allocation.recipient}`
      );
    }
    recipientPools.set(key, allocation.id);
  }

  const base = {
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
