import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { getAddress, ZeroAddress } from "ethers";
import tokenomics from "../../config/tokenomics.json";
import { Network, networkSettings, ROOT } from "./deployment";

type GenesisConfig = Record<Network, {
  chainId: number;
  token: string;
  startTimestamp: number | null;
  roundEndTimestamps: number[] | null;
  totalAllocation: string;
}>;
type MerkleData = ReturnType<StandardMerkleTree<[string, string]>["dump"]>;
export type GenesisArguments = [string, string, number, number[], string];

export function genesisArguments(
  network: string,
  config: GenesisConfig = JSON.parse(readFileSync(resolve(ROOT, "config/genesis-arguments.json"), "utf8")),
  data: MerkleData = JSON.parse(readFileSync(resolve(ROOT, "config/genesis-merkle-tree.json"), "utf8")),
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

  assert.deepEqual(data.leafEncoding, ["address", "uint256"], "Unexpected Genesis leaf encoding");
  const tree = StandardMerkleTree.load<[string, string]>(data);
  const accounts = new Set<string>();
  let snapshotTotal = 0n;
  for (const [, [account, balance]] of tree.entries()) {
    const address = getAddress(account);
    assert(address !== ZeroAddress && !accounts.has(address), "Invalid or duplicate Genesis account");
    accounts.add(address);
    assert(typeof balance === "string" && /^[0-9]+$/.test(balance) && BigInt(balance) > 0n,
      "Invalid Genesis snapshot balance");
    snapshotTotal += BigInt(balance);
  }
  const allocation = tokenomics.pools.find((pool) => pool.id === "genesis_allocation");
  assert(allocation, "Missing Genesis allocation");
  const totalAllocation = BigInt(allocation.amountTokens) * 10n ** 18n;
  assert.equal(snapshotTotal * 2n, totalAllocation, "Genesis snapshot total mismatch");
  assert.equal(entry.totalAllocation, totalAllocation.toString(), "Genesis configured allocation mismatch");
  return [token, tree.root, entry.startTimestamp, [...entry.roundEndTimestamps], totalAllocation.toString()];
}
