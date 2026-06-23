// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

// Pull OpenZeppelin's VestingWallet into the build so Hardhat produces its artifact
// for deployment. No custom logic - this is OZ's audited contract used as-is, so it
// does not add to our audit scope.
//
// If a cliff *inside* the total vesting period is ever needed (e.g. "48mo vesting,
// 12mo cliff" where the accrued portion unlocks at the cliff), import
// "@openzeppelin/contracts/finance/VestingWalletCliff.sol" instead - also library-provided.
import {VestingWallet} from "@openzeppelin/contracts/finance/VestingWallet.sol";
