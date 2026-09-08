import { expect } from "chai";
import { ethers } from "hardhat";
import { Transaction, Wallet, ZeroAddress } from "ethers";
import { deploymentSettings, networkSettings, TOTAL_SUPPLY } from "../scripts/lib/deployment";
import { attachSignature } from "../scripts/lib/ledger";

const DEPLOYER = "0x0000000000000000000000000000000000000001";
const RECIPIENT = "0x0000000000000000000000000000000000000002";
const config = () => ({
  bsc: { deployer: DEPLOYER, recipient: RECIPIENT },
  bscTestnet: { deployer: null, recipient: null },
  sepolia: { deployer: DEPLOYER, recipient: RECIPIENT },
});

describe("deployment", () => {
  it("requires configured, distinct nonzero addresses and a supported network", () => {
    expect(deploymentSettings("bsc", config())).to.include({ chainId: 56, deployer: DEPLOYER, recipient: RECIPIENT });
    expect(networkSettings("bscTestnet").chainId).to.equal(97);
    expect(deploymentSettings("sepolia", config())).to.include({ chainId: 11155111, deployer: DEPLOYER, recipient: RECIPIENT });
    expect(networkSettings("sepolia").rpcVariable).to.equal("SEPOLIA_RPC");
    expect(() => deploymentSettings("bscTestnet", config())).to.throw("Set deployer and recipient");
    expect(() => deploymentSettings("ethereum", config())).to.throw("Use bsc, bscTestnet or sepolia");
    for (const recipient of [ZeroAddress, DEPLOYER, "not-an-address"]) {
      const invalid = config();
      invalid.bsc.recipient = recipient;
      expect(() => deploymentSettings("bsc", invalid)).to.throw();
    }
  });

  it("mints the complete supply to one recipient without changing the token contract", async () => {
    const [, recipient] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("ApmFashion")).deploy([recipient.address], [TOTAL_SUPPLY]);
    expect(await token.totalSupply()).to.equal(TOTAL_SUPPLY);
    expect(await token.balanceOf(recipient.address)).to.equal(TOTAL_SUPPLY);
  });

  it("attaches Ledger-format signatures without changing the transaction and rejects a wrong signer", async () => {
    const wallet = Wallet.createRandom();
    for (const chainId of [56, 97, 11155111]) {
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
