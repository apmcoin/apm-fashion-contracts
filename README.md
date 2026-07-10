# apM Fashion Contracts

BEP-20 apM Fashion (`APM`) token deployment repository.

---

## Architecture

```
ApmFashion (ownerless, BSC)
  │  Full supply minted once at deploy to 5 Safe accounts
  │
  ├─ Safe — Genesis Allocation   (~39.95%)  0xd9C0E369981747851Badfbb540bC1bAb693A143A
  │    └─ GenesisClaim — ownerless, 36 monthly claim rounds
  ├─ Safe — Foundation           (25%)      0x2b6027A2aab2E865343eB5250D51Cd4fAFb73E12
  ├─ Safe — Rewards              (21%)      0x1d551e7d19eFaF70f01266481b5010d0C39c8aF0
  ├─ Safe — Investors            (5%)       0xB944a1ce8f7C691289aC90aa91B15804302F5d0F
  └─ Safe — Exchange Allocation  (~9.05%)   0x8495a2fDc58933B59345F5f83e74aE7b033b3A4e

Safe: Safe{Wallet} v1.4.1+L2 (BSC Mainnet), threshold 2/3
```

The Genesis Allocation amount is derived from legacy ERC-20 apM Coin non-foundation holder supply × 5 (1:5 conversion ratio). Distribution follows the [Genesis Claim Specification](docs/genesis-claim-plan.md).

---

## Files

| File | Role |
|---|---|
| `contracts/ApmFashion.sol` | Token contract. ERC-20 + ERC-20Permit. Full supply minted once in the constructor to the given recipients. |
| `contracts/GenesisClaim.sol` | Ownerless Merkle claim contract with 36 monthly rounds and dead-address handling for expired allocations. |
| `scripts/deploy.ts` | Deploys the token with the 5 Safe addresses as recipients. Verifies on-chain balances post-deploy. |
| `scripts/calcGenesisAirdrop.ts` | Queries Ethereum mainnet ERC-20 apM Coin → calculates Genesis Allocation → writes `allocations-calc.json` + `token-allocation.md`. |
| `config/allocations-calc.json` | Per-pool wei-precise amounts. Source of truth for deploy inputs. |
| `docs/token-allocation.md` | Human-readable view of `allocations-calc.json`. |
| `docs/genesis-claim-plan.md` | Public Genesis claim and expired-round specification. |
| `test/token.test.ts` | ApmFashion unit tests. |
| `test/genesis-claim.test.ts` | GenesisClaim unit and boundary tests. |

---

## Development

```bash
npm install
npm test
npm run build   # compile + flatten → flattened/ApmFashion.sol
```

---

## Deploy

Set `.env`:

```
DEPLOYER_PRIVATE_KEY=
BSC_RPC=
BSC_TESTNET_RPC=
```

Amounts are read from `config/allocations-calc.json` and recipient addresses from `config/recipients.json`.

```bash
npm run deploy:bscTestnet
npm run deploy:bsc
```

---

## Genesis Allocation Calculation

```bash
npx ts-node scripts/calcGenesisAirdrop.ts
```

Requires `ETH_RPC` in `.env`. Regenerates `config/allocations-calc.json` and `docs/token-allocation.md`.
