# apM Fashion Contracts

BEP-20 apM Fashion (`APM`) token policy, deployment, and verification repository.

## Architecture

```text
config/tokenomics.json ----\
                            +--> prepareDeployment --> deployment plan
config/recipients.json ----/                                  |
                                                               v
                                      ApmFashion deployment --> record --> verification

Legacy holder snapshot --> Merkle root --> GenesisClaim --> 36 monthly rounds
```

`ApmFashion` is an ownerless ERC-20 with ERC-2612 permit support. The complete
10,000,000,000 APM supply is minted once at deployment. Allocation amounts and
policy are documented in [Monetary Policy](docs/monetary-policy.md).

`GenesisClaim` provides 36 monthly Merkle-based claims for eligible legacy ERC-20
apM Coin holders.

`ApmFashion` does not enforce vesting or release schedules.

## Deployment Plan

Allocation amounts and recipient addresses are configured in `config/tokenomics.json`
and `config/recipients.json`.

```bash
npm run prepare:bscTestnet
npm run prepare:bsc
```

Review the generated `config/deployment-plan.<network>.json` before deployment.

## Development

```bash
npm ci
npm test
npm run build
```

`build` compiles the contracts and regenerates `flattened/ApmFashion.sol`.

## Deployment

Set the required values in `.env`:

```text
DEPLOYER_PRIVATE_KEY=
BSC_RPC=
BSC_TESTNET_RPC=
```

Deploy only after the matching deployment plan has been reviewed:

```bash
npm run deploy:bscTestnet
npm run deploy:bsc
```

Deployment records are written under `deployments/<chainId>/`.

```bash
npm run verify:onchain -- deployments/<chainId>/<tokenAddress>.json
```

## Audit Scope

The CertiK assessment covers only `contracts/ApmFashion.sol` at commit
`2bfbf42328e7eaee31fbd2ce17c91c796d1b7d92`. Allocation policy, recipient
configuration, `GenesisClaim`, release schedules, deployment scripts, and
operational controls are outside that source-code audit scope.

- [Audited source](https://github.com/apmcoin/apm-fashion-contracts/blob/2bfbf42328e7eaee31fbd2ce17c91c796d1b7d92/contracts/ApmFashion.sol)
- [CertiK report](docs/CertiK-REP-apM-Fashion-Audit-V1.pdf)
