import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAddress, ZeroAddress } from "ethers";
import tokenomics from "../../config/tokenomics.json";
import { Network, networkSettings, ROOT } from "./deployment";

const GENESIS_MERKLE_ROOT = "0x43c76cc4b8f874c5688ede19a01dca8902d73a73216a7ac588441ecd6453d1a5";

type GenesisConfig = Record<Network, {
  chainId: number;
  token: string;
  startTimestamp: number | null;
  roundEndTimestamps: number[] | null;
  totalAllocation: string;
}>;
export type GenesisArguments = [string, string, number, number[], string];

export function genesisArguments(
  network: string,
  config: GenesisConfig = JSON.parse(readFileSync(resolve(ROOT, "config/genesis-arguments.json"), "utf8")),
): GenesisArguments {
  const settings = networkSettings(network);
  const entry = config[settings.network];
  assert(entry && entry.chainId === settings.chainId, "Genesis chain mismatch");
  const token = getAddress(entry.token);
  assert.notEqual(token, ZeroAddress, "Set the Genesis token");
  assert(entry.startTimestamp !== null && Number.isSafeInteger(entry.startTimestamp) && entry.startTimestamp > 0,
    "Set the Genesis start timestamp");
  assert(entry.roundEndTimestamps?.length === 36 && entry.roundEndTimestamps.every(Number.isSafeInteger),
    "Set all 36 Genesis round end timestamps");

  const allocation = tokenomics.pools.find((pool) => pool.id === "genesis_allocation");
  assert(allocation, "Missing Genesis allocation");
  const totalAllocation = BigInt(allocation.amountTokens) * 10n ** 18n;
  assert.equal(entry.totalAllocation, totalAllocation.toString(), "Genesis configured allocation mismatch");
  return [token, GENESIS_MERKLE_ROOT, entry.startTimestamp, [...entry.roundEndTimestamps], totalAllocation.toString()];
}
