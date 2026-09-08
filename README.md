# apM Fashion Contracts

Solidity contracts for apM Fashion.

- [ApmFashion](contracts/ApmFashion.sol): fixed-supply BEP-20 token.
- [GenesisClaim](contracts/GenesisClaim.sol): Merkle-based token claims.
- [Monetary Policy](docs/monetary-policy.md)

BNB Smart Chain mainnet:
[0x72a22fAA6a522C81A8F5d508381e18af3dA0921E](https://bscscan.com/token/0x72a22fAA6a522C81A8F5d508381e18af3dA0921E)

## Development

```bash
npm ci
npm test
npm run build
```

## Deployment

Local settings: `config/deployment.json` and `.env`, using the
[deployment](config/deployment.example.json) and [environment](.env.example) templates.

```bash
npm run deploy:bscTestnet
npm run deploy:sepolia
npm run deploy:bsc
npm run verify:onchain -- deployments/<chainId>/<tokenAddress>.json
```

## Audit

CertiK review of `ApmFashion.sol`:
[report](docs/CertiK-REP-apM-Fashion-Audit-V1.pdf) and
[audited source](https://github.com/apmcoin/apm-fashion-contracts/blob/2bfbf42328e7eaee31fbd2ce17c91c796d1b7d92/contracts/ApmFashion.sol).
