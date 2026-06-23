# apM Fashion Contracts

Smart contracts for apM Fashion. Currently a fixed-supply token and cliff-vesting wallets;
more contracts will be added over time.

## Contracts

- **ApmFashion** — `ERC20` + `ERC20Permit`. Fixed supply of 10,000,000,000 APM (18 decimals),
  minted once in the constructor to the addresses passed as arguments. No owner, no minting
  after deployment, no pause, no blacklist. `name` and `symbol` are immutable.
- **CliffVestingWallet** — OpenZeppelin `VestingWallet` with a cliff. Each instance takes its
  own `start`, `duration`, and `cliff` at deployment. `owner` is the beneficiary; the schedule
  is immutable and `release()` is permissionless.

## Stack

- Solidity 0.8.27, optimizer (200 runs), evmVersion `cancun`
- `@openzeppelin/contracts` 5.6.1 (exact pin; reproducibility via `package-lock.json`)
- Hardhat 2.28.6, `hardhat-toolbox` 5.0.0, `hardhat-verify`

## Usage

```bash
npm install
npm run compile
npm test

cp .env.example .env   # fill DEPLOYER_PRIVATE_KEY / BSCSCAN_API_KEY
npm run deploy:bscTestnet
npm run deploy:bsc
```

## Notes

- Allocations and vesting schedules are deployment arguments — set them in `scripts/deploy.ts`.
- Token logos are registered off-chain (BscScan, token lists); ERC-20 has no logo field.
- Confirm the on-chain `symbol` matches the exchange listing ticker before deploying (immutable).
