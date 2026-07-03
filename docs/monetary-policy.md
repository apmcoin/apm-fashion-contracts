# apM Fashion (APM) — Monetary Policy

## Supply

| Parameter | Value |
|---|---|
| Total Supply | 10,000,000,000 APM |
| Decimals | 18 |
| Mintable | No |
| Burnable | No |
| Pausable | No |
| Owner | None (ownerless) |

Total supply is minted once at deployment. No mechanism exists to increase or decrease it.

## Allocation

| Pool | Amount (APM) | Share |
|---|---|---|
| Genesis Allocation | 3,995,287,829.626... | ~39.95% |
| Foundation | 2,500,000,000 | 25.00% |
| Rewards | 2,100,000,000 | 21.00% |
| Investors | 500,000,000 | 5.00% |
| Exchange Allocation | 904,712,170.373... | ~9.05% |
| **Total** | **10,000,000,000** | **100%** |

Full wei-precise amounts: [docs/token-allocation.md](token-allocation.md)

## Vesting Schedule

| Pool | Vesting |
|---|---|
| Genesis Allocation | 24-month linear |
| Foundation | 1-year cliff, 36-month linear |
| Rewards | 24-month linear |
| Investors | 1-year cliff, 24-month linear |
| Exchange Allocation | Listing-dependent unlock |

Vesting parameters are subject to adjustment prior to TGE.

## Genesis Allocation

The Genesis Allocation is derived from the legacy ERC-20 apM Coin (Ethereum mainnet) non-foundation holder supply at a 1:5 conversion ratio. See [docs/token-allocation.md](token-allocation.md) for derivation details.
