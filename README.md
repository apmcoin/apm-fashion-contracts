# apM Fashion Token

Fixed-supply, **ownerless**, immutable BEP-20 token for the apM Fashion relaunch, plus
cliff-vesting wallets for locked allocations.

## Design

- **`ApmFashion`** — `ERC20` + `ERC20Permit`. Total supply **10,000,000,000 APM** (18 decimals),
  minted once in the constructor across recipients passed as deploy args. No owner, no mint
  after construction, no pause, no blacklist, no metadata setter.
  - `name` = `apM Fashion`, `symbol` = `APM` (hardcoded, immutable; matches Permit EIP-712 domain).
- **`CliffVestingWallet`** — extends OpenZeppelin `VestingWallet` with a cliff. Schedule
  (`start`, `duration`, `cliff`) is fully set per instance via deploy args. `owner == beneficiary`
  (no privileged control lever; the schedule is immutable, `release()` is permissionless).

### Why ownerless

Removing all privileged functions eliminates the centralization-privilege audit finding entirely
(there is no function to abuse). Allocation concentration is mitigated by locking long-term
tranches in vesting contracts; immediately-needed tranches go to cold-wallet EOAs and are disclosed.

## Stack

- Solidity **0.8.27** (pinned exact), optimizer on (200 runs), evmVersion `cancun`.
- **`@openzeppelin/contracts` 5.6.1** (pinned exact; reproducibility via committed `package-lock.json`).
- Hardhat **2.28.6** + `hardhat-toolbox` 5.0.0 (ethers v6, hardhat-verify v2).
- No vendoring, no flattening — verification via `hardhat-verify` (standard-json multi-file).

## Usage

```bash
npm install
npm run compile
npm test

# deploy (fill scripts/deploy.ts allocations first; set .env)
npm run deploy:bscTestnet
npm run deploy:bsc
```

Copy `.env.example` to `.env` and fill `DEPLOYER_PRIVATE_KEY` / `BSCSCAN_API_KEY`.

## Notes

- Logos are **off-chain** (BscScan token info, CoinGecko/CMC, token lists) — not an ERC-20 field.
- Confirm the on-chain `symbol` ("APM") matches the exchange listing ticker before deploy (immutable).
- BscScan now uses Etherscan API v2 keys; if verification fails, update the API key/plugin accordingly.
