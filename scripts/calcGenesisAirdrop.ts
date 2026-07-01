/**
 * Genesis Airdrop Allocation Calculator
 *
 * Calculates the BEP-20 apM Fashion genesis airdrop allocation.
 *
 * The foundation-held wallets (DRR Buyback1, DRR Buyback2, Global&Reward)
 * are excluded from the legacy ERC-20 apM Coin total supply.
 * The remaining holder supply is multiplied by 5 to derive the genesis airdrop
 * allocation for the new BEP-20 token.
 *
 * Fixed allocations (whole tokens):
 *   Foundation  : 25%  = 2,500,000,000
 *   Rewards     : 21%  = 2,100,000,000
 *   Investors   :  5%  =   500,000,000
 *   Exchange    : remainder after the above four pools
 *
 *   genesisAirdrop = holderSupply × 5   (1:5 conversion ratio)
 *   exchange       = 10,000,000,000 - genesis - foundation - rewards - investors
 *
 * Output: config/allocations-calc.json
 * To generate docs/token-allocation.md from the JSON, run:
 *   npx ts-node scripts/generateAllocationMd.ts
 *
 * Usage:
 *   npx ts-node scripts/calcGenesisAirdrop.ts
 *   (ETH_RPC is loaded from .env automatically)
 */

import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";

const OLD_TOKEN = "0xc8c424b91d8ce0137bab4b832b7f7d154156ba6c";
const FOUNDATION_WALLETS: Record<string, string> = {
  "DRR Buyback1":  "0x069b1168B112621BAFB6F4e50E623977C2113108",
  "DRR Buyback2":  "0xE82FE16E845b4B00B860f061C91F40F12002E926",
  "Global&Reward": "0xDA77254612E963b0ae2B585C23193175b368eB91",
};

const NEW_TOTAL_TOKENS = 10_000_000_000n;
const E18 = 10n ** 18n;
const AIRDROP_MULTIPLIER = 5n;

// Fixed whole-token allocations
const FOUNDATION_TOKENS = 2_500_000_000n;
const REWARDS_TOKENS    = 2_100_000_000n;
const INVESTORS_TOKENS  =   500_000_000n;

const ERC20_ABI = [
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
];

function human(n: bigint, dec: number): string {
  const d = 10n ** BigInt(dec);
  const whole = n / d;
  const frac = n % d;
  if (frac === 0n) return whole.toLocaleString("en-US");
  const fracStr = frac.toString().padStart(dec, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}.${fracStr}`;
}

function weiSpaced(n: bigint): string {
  return n.toString().replace(/\B(?=(\d{4})+(?!\d))/g, " ");
}

function row(label: string, n: bigint, dec: number, unit: string) {
  const lbl = label.padEnd(26);
  console.log(`  ${lbl} ${human(n, dec).padStart(36)} ${unit}`);
  console.log(`  ${"".padEnd(26)} ${weiSpaced(n).padStart(36)} wei`);
}

function percent(part: bigint, total: bigint): string {
  const SCALE = 10n ** 10n;
  const scaled = (part * 100n * SCALE) / total;
  const whole = scaled / SCALE;
  const frac = scaled % SCALE;
  const fracStr = frac.toString().padStart(10, "0").replace(/0+$/, "") || "0";
  return `${whole}.${fracStr}`;
}

function renderMd(d: ReturnType<typeof buildJsonData>): string {
  const walletRows = Object.entries(d.legacyFoundationWallets)
    .map(([label, w]) => `| ${label} | \`${w.address}\` | ${human(BigInt(w.balanceWei), 18)} |`)
    .join("\n");

  const allocRows = d.allocations
    .map((a) => `| ${a.pool.padEnd(16)} | ${a.amountTokens.padStart(33)} | ${a.share.padStart(12)} |`)
    .join("\n");

  const weiRows = d.allocations
    .map((a) => `| ${a.pool.padEnd(16)} | \`${a.amountWei}\` |`)
    .join("\n");

  return `# BEP-20 apM Fashion — Token Allocation

> Generated: ${d.generatedAt}
> Source: \`${d.script}\`

## Summary

| Pool             |            Amount (APM)           |        Share |
|------------------|----------------------------------:|-------------:|
${allocRows}
| **Total**        |             **10,000,000,000**    |     **100%** |

## Allocation Detail (wei)

| Pool             | Amount (wei)                       |
|------------------|------------------------------------|
${weiRows}

Total supply checksum: \`${d.newTotalSupplyWei}\` (= 10,000,000,000 × 10^18)

## Genesis Airdrop Derivation

The genesis airdrop is derived from the legacy **ERC-20 apM Coin** supply
on Ethereum mainnet (\`${d.legacyToken}\`).

| Field                         | Value |
|-------------------------------|-------|
| ERC-20 Total Supply           | ${human(BigInt(d.legacyTotalSupplyWei), 18)} APM |
| Foundation Wallets (excluded) | ${human(BigInt(d.legacyFoundationTotalWei), 18)} APM |
| **Holder Supply**             | **${human(BigInt(d.legacyHolderSupplyWei), 18)} APM** |
| Conversion ratio              | 1 : ${d.airdropMultiplier} |
| **Genesis Airdrop (BEP-20)**  | **${d.allocations[0].amountTokens} APM** |

### Foundation Wallets Excluded from Airdrop

| Wallet           | Address | Balance (ERC-20 APM) |
|------------------|---------|----------------------|
${walletRows}
`;
}

// typed helper so renderMd can reference the shape
function buildJsonData(
  generatedAt: string,
  OLD_TOKEN: string,
  totalSupply: bigint,
  FOUNDATION_WALLETS: Record<string, string>,
  walletBalances: Record<string, bigint>,
  foundationTotal: bigint,
  holderSupply: bigint,
  AIRDROP_MULTIPLIER: bigint,
  newTotalWei: bigint,
  pools: Array<{ pool: string; wei: bigint }>
) {
  return {
    generatedAt,
    script: "npx ts-node scripts/calcGenesisAirdrop.ts",
    legacyToken: OLD_TOKEN,
    legacyTotalSupplyWei: totalSupply.toString(),
    legacyFoundationWallets: Object.fromEntries(
      Object.entries(FOUNDATION_WALLETS).map(([label, addr]) => [
        label,
        { address: addr, balanceWei: walletBalances[label].toString() },
      ])
    ),
    legacyFoundationTotalWei: foundationTotal.toString(),
    legacyHolderSupplyWei: holderSupply.toString(),
    airdropMultiplier: Number(AIRDROP_MULTIPLIER),
    newTotalSupplyWei: newTotalWei.toString(),
    allocations: pools.map((p) => ({
      pool: p.pool,
      amountWei: p.wei.toString(),
      amountTokens: human(p.wei, 18),
      share: percent(p.wei, newTotalWei) + "%",
    })),
  };
}

async function main() {
  const rpc = process.env.ETH_RPC;
  if (!rpc) throw new Error("ETH_RPC not set in .env");

  const generatedAt = new Date().toISOString();

  console.log("=".repeat(70));
  console.log("  BEP-20 apM Fashion - Genesis Airdrop Allocation Calculator");
  console.log("=".repeat(70));
  console.log("  Foundation-held wallets are excluded from the legacy ERC-20 supply.");
  console.log("  Holder supply x5 = BEP-20 genesis airdrop allocation.");
  console.log("  Foundation / Rewards / Investors are fixed whole-token amounts.");
  console.log("  Exchange = remainder (total - all other pools).");
  console.log(`  Generated : ${generatedAt}`);
  console.log(`  Script    : npx ts-node scripts/calcGenesisAirdrop.ts`);
  console.log("=".repeat(70));

  const provider = new ethers.JsonRpcProvider(rpc);
  const token = new ethers.Contract(OLD_TOKEN, ERC20_ABI, provider);

  const decimals = Number(await token.decimals());
  const totalSupply: bigint = await token.totalSupply();

  console.log(`\n[Legacy ERC-20 apM Coin]  ${OLD_TOKEN}`);
  console.log(`Decimals         : ${decimals}`);
  row("Total Supply", totalSupply, decimals, "APM (ERC-20 apM Coin)");

  console.log("\n[Foundation Wallets - excluded from airdrop]");
  const walletBalances: Record<string, bigint> = {};
  let foundationTotal = 0n;
  for (const [label, addr] of Object.entries(FOUNDATION_WALLETS)) {
    const bal: bigint = await token.balanceOf(addr);
    walletBalances[label] = bal;
    console.log(`  ${label.padEnd(20)} ${addr}`);
    console.log(`  ${"".padEnd(20)} human : ${human(bal, decimals)} APM (ERC-20 apM Coin)`);
    console.log(`  ${"".padEnd(20)} wei   : ${weiSpaced(bal)}`);
    foundationTotal += bal;
  }
  console.log();
  row("Foundation Total (excl.)", foundationTotal, decimals, "APM (ERC-20 apM Coin)");

  const holderSupply = totalSupply - foundationTotal;
  if (holderSupply <= 0n) throw new Error("holderSupply is zero or negative — check wallet addresses");

  // --- compute allocations ---
  const legacyUnit    = 10n ** BigInt(decimals);
  const genesisWei    = (holderSupply * AIRDROP_MULTIPLIER * E18) / legacyUnit;
  const foundationWei = FOUNDATION_TOKENS * E18;
  const rewardsWei    = REWARDS_TOKENS    * E18;
  const investorsWei  = INVESTORS_TOKENS  * E18;
  const newTotalWei   = NEW_TOTAL_TOKENS  * E18;
  const exchangeWei   = newTotalWei - genesisWei - foundationWei - rewardsWei - investorsWei;

  if (exchangeWei <= 0n) throw new Error("exchangeWei is zero or negative — allocations exceed total supply");
  if (genesisWei + foundationWei + rewardsWei + investorsWei + exchangeWei !== newTotalWei)
    throw new Error("checksum FAIL");

  const pools: Array<{ pool: string; wei: bigint }> = [
    { pool: "Genesis Airdrop", wei: genesisWei    },
    { pool: "Foundation",      wei: foundationWei },
    { pool: "Rewards",         wei: rewardsWei    },
    { pool: "Investors",       wei: investorsWei  },
    { pool: "Exchange",        wei: exchangeWei   },
  ];

  console.log("\n[BEP-20 apM Fashion New Allocation — Total Supply 10,000,000,000]");
  row("Holder Supply (ERC-20)", holderSupply, decimals, "APM (ERC-20 apM Coin)");
  console.log();
  for (const p of pools) {
    row(p.pool, p.wei, 18, "APM (BEP-20 apM Fashion)");
    console.log(`  ${"".padEnd(26)} ${percent(p.wei, newTotalWei).padStart(16)}%`);
    console.log();
  }
  row("Total (checksum)", newTotalWei, 18, "APM (BEP-20 apM Fashion)");
  console.log(`  ${"".padEnd(26)} ${"100".padStart(16)}%`);

  // --- JSON ---
  const jsonPath = path.join("config", "allocations-calc.json");
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  const jsonData = buildJsonData(
    generatedAt, OLD_TOKEN, totalSupply,
    FOUNDATION_WALLETS, walletBalances,
    foundationTotal, holderSupply, AIRDROP_MULTIPLIER,
    newTotalWei, pools
  );
  fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2));

  // --- Markdown (view of jsonData — no independent computation) ---
  const mdPath = path.join("docs", "token-allocation.md");
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.writeFileSync(mdPath, renderMd(jsonData));

  console.log(`\nSaved: ${jsonPath}`);
  console.log(`Saved: ${mdPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
