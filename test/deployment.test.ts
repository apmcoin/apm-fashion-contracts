import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "chai";
import { Transaction, Wallet, ZeroAddress } from "ethers";
import genesisConfig from "../config/genesis-arguments.json";
import { deployerSettings, networkSettings } from "../scripts/lib/deployment";
import { genesisArguments } from "../scripts/lib/genesis";
import { attachSignature } from "../scripts/lib/ledger";

const DEPLOYER = "0x0000000000000000000000000000000000000001";
const config = () => ({
  bsc: { deployer: DEPLOYER },
  sepolia: { deployer: DEPLOYER },
});

describe("deployment", () => {
  it("uses the fixed Genesis root on both networks and matches the archived tree", () => {
    const root = "0x43c76cc4b8f874c5688ede19a01dca8902d73a73216a7ac588441ecd6453d1a5";
    const archive = JSON.parse(readFileSync(resolve(__dirname, "../config/genesis-merkle-tree.json"), "utf8"));
    expect(archive.tree[0]).to.equal(root);
    for (const network of ["bsc", "sepolia"] as const) {
      const entry = genesisConfig[network];
      expect(genesisArguments(network, genesisConfig)).to.deep.equal([
        entry.token, root, entry.startTimestamp, entry.roundEndTimestamps, entry.totalAllocation,
      ]);
    }
    const unconfigured = { ...genesisConfig, sepolia: { ...genesisConfig.sepolia, startTimestamp: null } };
    expect(() => genesisArguments("sepolia", unconfigured)).to.throw("Set the Genesis start timestamp");
  });

  it("allows five-minute Sepolia rounds while retaining BSC interval checks", () => {
    const configured = structuredClone(genesisConfig);
    for (const network of ["bsc", "sepolia"] as const) {
      const entry = configured[network];
      entry.roundEndTimestamps = Array.from({ length: 36 }, (_, round) => entry.startTimestamp + (round + 1) * 300);
    }
    expect(genesisArguments("sepolia", configured)[3]).to.deep.equal(configured.sepolia.roundEndTimestamps);
    expect(() => genesisArguments("bsc", configured)).to.throw("BSC Genesis rounds must span 28 to 31 days");

    for (const round of [0, 1, 35]) {
      for (const interval of [28 * 86400 - 1, 31 * 86400 + 1]) {
        const invalid = structuredClone(genesisConfig);
        const entry = invalid.bsc;
        entry.roundEndTimestamps[round] = (round === 0 ? entry.startTimestamp : entry.roundEndTimestamps[round - 1]) + interval;
        expect(() => genesisArguments("bsc", invalid)).to.throw("BSC Genesis rounds must span 28 to 31 days");
      }
    }
    let end = configured.bsc.startTimestamp;
    configured.bsc.roundEndTimestamps = Array.from({ length: 36 }, (_, round) => end += [28, 29, 30, 31][round % 4] * 86400);
    expect(() => genesisArguments("bsc", configured)).not.to.throw();
  });

  it("rejects non-increasing round ends on both networks", () => {
    for (const network of ["bsc", "sepolia"] as const) {
      for (const round of [0, 1, 35]) {
        const configured = structuredClone(genesisConfig);
        const entry = configured[network];
        entry.roundEndTimestamps[round] = round === 0 ? entry.startTimestamp : entry.roundEndTimestamps[round - 1];
        expect(() => genesisArguments(network, configured)).to.throw("Genesis round ends must increase after the start timestamp");
      }
    }
  });

  it("requires a configured nonzero deployer and a supported network", () => {
    expect(deployerSettings("bsc", config())).to.deep.equal({ network: "bsc", chainId: 56, rpcVariable: "BSC_RPC", deployer: DEPLOYER });
    expect(networkSettings("bsc").rpcVariable).to.equal("BSC_RPC");
    expect(deployerSettings("sepolia", config())).to.include({ chainId: 11155111, deployer: DEPLOYER });
    expect(networkSettings("sepolia").rpcVariable).to.equal("SEPOLIA_RPC");
    expect(() => deployerSettings("bsc", { ...config(), bsc: { deployer: null } }))
      .to.throw("Set deployer");
    expect(() => deployerSettings("ethereum", config())).to.throw("Use bsc or sepolia");
    for (const deployer of [ZeroAddress, "not-an-address"]) {
      const invalid = config();
      invalid.bsc.deployer = deployer;
      expect(() => deployerSettings("bsc", invalid)).to.throw();
    }
  });

  it("attaches Ledger-format signatures without changing the transaction and rejects a wrong signer", async () => {
    const wallet = Wallet.createRandom();
    for (const chainId of [56, 11155111]) {
      const transaction = Transaction.from({ type: 0, chainId, nonce: 0, gasPrice: 1n, gasLimit: 100_000n, data: "0x6000", value: 0n });
      const signature = Transaction.from(await wallet.signTransaction(transaction)).signature!;
      for (const v of [signature.v, Number(signature.yParity), chainId * 2 + 35 + signature.yParity]) {
        const signed = Transaction.from(attachSignature(transaction, { r: signature.r, s: signature.s, v }, wallet.address));
        expect(signed.unsignedSerialized).to.equal(transaction.unsignedSerialized);
        expect(signed.from).to.equal(wallet.address);
      }
      expect(() => attachSignature(transaction, signature, DEPLOYER)).to.throw("Ledger signing address mismatch");
    }
  });
});
