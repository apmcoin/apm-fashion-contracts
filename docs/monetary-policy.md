# apM Fashion (APM) - Monetary Policy

## Supply

| Parameter | Value |
|---|---|
| Total Supply | 10,000,000,000 APM |
| Decimals | 18 |
| Mintable after deployment | No |
| Supply-reducing burn function | No |
| Pausable | No |
| Contract owner | None |

The complete supply is minted once during deployment. The token contract has no
mechanism to increase or decrease `totalSupply` afterward.

## Allocation

| Pool | Amount (APM) | Share |
|---|---:|---:|
| Ecosystem & Network Growth | 3,100,000,000 | 31.00% |
| Foundation | 2,500,000,000 | 25.00% |
| Rewards | 3,000,000,000 | 30.00% |
| Investors | 500,000,000 | 5.00% |
| Exchange Allocation | 700,000,000 | 7.00% |
| Liquidity Supply | 200,000,000 | 2.00% |
| **Total** | **10,000,000,000** | **100.00%** |

The machine-readable policy is maintained in
[`config/tokenomics.json`](../config/tokenomics.json). Exact wei amounts,
recipient addresses, and policy checksums are fixed in the reviewed
[BSC deployment plan](../config/deployment-plan.bsc.json).

## Release Controls

Pool release schedules are defined in the approved Token Release Schedule. They
are not encoded in `ApmFashion.sol`, which mints each pool allocation to its
designated recipient during deployment. Multisig configuration and release
operations must be verified separately from the token contract audit.
