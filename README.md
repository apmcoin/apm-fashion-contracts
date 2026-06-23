# apM Fashion Contracts

Smart contracts for apM Fashion. More contracts will be added over time.

## Contracts

- **ApmFashion** — the only contract deployed and the sole audit target. `ERC20` + `ERC20Permit`
  (both imported from OpenZeppelin). Fixed supply of 10,000,000,000 APM (18 decimals), minted once
  in the constructor. No owner, no minting after deployment, no pause, no blacklist. `name` and
  `symbol` are immutable. A standard ERC20 — no transfer restrictions.

  The constructor mints the whole supply in one transaction: **every allocation pool** is minted
  into a freshly deployed OpenZeppelin `VestingWallet` (imported and created with `new`), one per
  pool, with per-pool `(start, duration)`. A pool that must be liquid at TGE simply uses
  `duration = 0`. The token adds **no custom vesting logic** — only argument forwarding and the
  `sum == TOTAL_SUPPLY` invariant.

Schedule per pool via `(start, duration)`:

- pure linear: `start = TGE`, `duration = period`
- cliff + linear: `start = TGE + cliff`, `duration = period`
- pure cliff (full unlock): `start = TGE + cliff`, `duration = 0`
- liquid at TGE: `start = TGE`, `duration = 0`

## Stack

- Solidity 0.8.27, optimizer (200 runs), evmVersion `cancun`
- `@openzeppelin/contracts` 5.6.1 (exact pin; reproducibility via `package-lock.json`)
- Hardhat 2.28.6, `hardhat-toolbox` 5.0.0
- Explorer verification via the committed `flattened/ApmFashion.sol` (regenerate with `npm run build`)

## Usage

```bash
npm install
npm run compile
npm test
npm run build          # compile + (re)generate flattened/ApmFashion.sol

cp .env.example .env   # fill DEPLOYER_PRIVATE_KEY
npm run deploy:bscTestnet
npm run deploy:bsc
```

## Notes

- Allocations and vesting schedules are deployment arguments — set them in `scripts/deploy.ts`.
- Source comments are ASCII-only to avoid any verification encoding mismatch.
- Token logos are registered off-chain (BscScan, token lists); ERC-20 has no logo field.
- Confirm the on-chain `symbol` matches the exchange listing ticker before deploying (immutable).
