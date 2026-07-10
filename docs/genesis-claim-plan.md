# Genesis Claim Specification

## Overview

- Eligible balances are determined at a designated snapshot block.
- Policy-defined excluded addresses are removed before applying the `x5`
  conversion ratio.
- A single Merkle root commits each eligible account's total 36-round
  entitlement.
- Claims are divided across 36 monthly rounds.
- A missed round does not carry forward.
- The claim contract has no owner or administrative withdrawal function.
- Unclaimed tokens from an expired round are sent to the dead address and
  become permanently unrecoverable without reducing ERC-20 `totalSupply`.

## Snapshot and Merkle commitment

Snapshot balances and exclusions are calculated in integer base units. The
resulting account entitlements are committed using an OpenZeppelin standard
Merkle tree with the following leaf structure:

```text
[index, account, totalEntitlementWei]
```

Before deployment, the following values must match:

```text
sum(all totalEntitlementWei) == published Genesis Allocation
sum(all round allocations) == published Genesis Allocation
independently recomputed root == deployment Merkle root
claim contract funding == published Genesis Allocation
```

The Merkle proof verifies both eligibility and the total entitlement directly
against the deployed root.

## Claim calculation

The deployment fixes the token address, Merkle root, TGE timestamp, 36 round
end timestamps, and 36 round allocations.

```text
round = currentRound(block.timestamp)
require(!claimedByRound[round][index])
verify([index, account, totalEntitlementWei], proof)

base = totalEntitlementWei / 36
amount = round < 35
    ? base
    : totalEntitlementWei - base * 35
```

- Each account may claim once during each active round.
- Anyone may submit a valid claim, but tokens are always transferred to the
  account committed in the Merkle leaf.
- Claims from previous rounds cannot be recovered in later rounds.
- Integer division remainder is included in the account's final-round amount.

## Expired-round dead-address transfer

After a round ends, anyone may call the settlement function. Settlement sends
the difference between that round's allocation and claimed amount to:

```text
0x000000000000000000000000000000000000dEaD
```

This permanently removes the tokens from circulation. It is a transfer to the
dead address, not a supply-reducing ERC-20 burn.

- Settlement is permissionless and independent from the claim function.
- Multiple expired rounds may be settled in one transaction.
- A round with no claimants sends its entire allocation to the dead address.
- The final round is settled by the same rule after its end timestamp.
- Settled rounds cannot be claimed again or settled twice.

## Schedule

- The TGE timestamp and all 36 round end timestamps are fixed at deployment.
- Every timestamp must be strictly later than the previous timestamp.
- Each round interval must be between 28 and 31 days.
- The schedule cannot be changed after deployment.

## Public verification

The deployed contract allows independent verification of:

- Token address and Merkle root
- TGE timestamp and all round end timestamps
- Allocation and claimed amount for every round
- Claimed status for each Merkle index and round
- Settled-round progress and amounts sent to the dead address
