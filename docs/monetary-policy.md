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
| Genesis Allocation | 1,598,200,000 | 15.982% |
| Ecosystem & Network Growth | 1,501,800,000 | 15.018% |
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

Genesis Allocation is distributed through the ownerless `GenesisClaim`
contract over 36 monthly rounds. Missed claims do not carry forward. After each
round closes, its unclaimed allocation is transferred to the dead address.
Eligible legacy ERC-20 apM Coin holders receive 2 APM for each eligible legacy
token: 799,100,000 apM Coin multiplied by 2 equals 1,598,200,000 APM.
