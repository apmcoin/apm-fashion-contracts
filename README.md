# apM Fashion Contracts

Fixed-supply, ownerless BEP-20 token for apM Fashion.

## Contracts

- `ApmFashion` — `ERC20` + `ERC20Permit`. Fixed supply 10,000,000,000 (18 decimals), minted once
  in the constructor. No owner, no mint after deploy, no pause, no blacklist. Each allocation pool
  is minted into an OpenZeppelin `VestingWallet`; pools liquid at TGE use `duration = 0`.

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
