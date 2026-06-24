# apM Fashion Contracts

Fixed-supply, ownerless BEP-20 token for apM Fashion.

## Contracts

- `ApmFashion` — `ERC20` + `ERC20Permit`. Fixed supply 10,000,000,000 (18 decimals), minted once
  in the constructor to the given recipients. No owner, no mint after deploy, no pause, no
  blacklist. This is the only in-scope contract.

The deploy script deploys one stock OpenZeppelin `VestingWallet` per allocation pool, mints the
supply directly into them, then verifies the on-chain state. The vesting wallets are unmodified
OpenZeppelin (out of audit scope).

## Develop

```bash
npm install
npm test
npm run build      # compile + flatten -> flattened/ApmFashion.sol
```

## Deploy

Set `DEPLOYER_PRIVATE_KEY`, `TGE_ISO`, and `ALLOCATIONS` in `.env`, then:

```bash
npm run deploy:bscTestnet
npm run deploy:bsc
```

Allocations are read from a CSV (`config/allocations.example.csv` is the template):
`pool,address,amount,cliffMonths,linearMonths`.
