# apM Fashion Contracts

BEP-20 apM Fashion (`APM`) token policy, deployment, and verification repository.

## Architecture

```text
config/tokenomics.json ----\
                            +--> prepareDeployment --> deployment plan
config/recipients.json ----/                                  |
                                                               v
                                      ApmFashion deployment --> record --> verification
```

`ApmFashion` is an ownerless ERC-20 with ERC-2612 permit support. The complete
10,000,000,000 APM supply is minted once at deployment to six designated pool
recipients.

| Pool | Share |
|---|---:|
| Ecosystem & Network Growth | 31% |
| Foundation | 25% |
| Rewards | 30% |
| Investors | 5% |
| Exchange Allocation | 7% |
| Liquidity Supply | 2% |

The token contract does not contain minting, ownership, pause, burn, or vesting
administration after deployment. Pool release schedules are governed by the
approved Token Release Schedule and the designated multisig accounts.

## Deployment Plan

`config/tokenomics.json` is the allocation policy source of truth. Recipient
addresses are configured separately by network in `config/recipients.json`.
Plan generation validates six unique pool IDs and recipients, a 10,000
basis-point total, exact integer wei amounts, and the 10 billion APM supply
checksum.

```bash
npm run prepare:bscTestnet
npm run prepare:bsc
```

The resulting `config/deployment-plan.<network>.json` fixes the chain ID,
recipients, amounts, constructor arguments, policy hash, recipient hash, and
final plan hash. It must be reviewed before deployment. Deployment rejects the
plan if it no longer matches the current tokenomics or recipient configuration.

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

Deployment writes a self-contained record under `deployments/<chainId>/`. The
record includes the approved plan, token address, deployment transaction,
block number, and runtime bytecode hash.

```bash
npm run verify:onchain -- deployments/<chainId>/<tokenAddress>.json
```

Verification uses the deployment-time record rather than mutable current
configuration. It validates the chain, deployment receipt, initial mint events,
token metadata, total supply, ownerless behavior, and runtime bytecode hash.

## Audit Scope

The CertiK assessment covers only `contracts/ApmFashion.sol` at commit
`2bfbf42328e7eaee31fbd2ce17c91c796d1b7d92`. Allocation policy, recipient
configuration, release schedules, deployment scripts, and operational controls
are outside that source-code audit scope.

- [Audited source](https://github.com/apmcoin/apm-fashion-contracts/blob/2bfbf42328e7eaee31fbd2ce17c91c796d1b7d92/contracts/ApmFashion.sol)
- [CertiK report](docs/CertiK-REP-apM-Fashion-Audit-V1.pdf)
