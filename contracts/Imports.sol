// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

// Tooling import: pulls OpenZeppelin's VestingWallet into the build so the deploy script can
// deploy it. Stock OZ, out of audit scope (in-scope contract is ApmFashion.sol).
import {VestingWallet} from "@openzeppelin/contracts/finance/VestingWallet.sol";
