// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {VestingWallet} from "@openzeppelin/contracts/finance/VestingWallet.sol";

/// @title apM Fashion
/// @notice Fixed-supply, ownerless, immutable BEP-20 token (standard ERC20, no transfer
///         restrictions). The constructor mints the entire supply once: every allocation pool is
///         minted into a freshly deployed OpenZeppelin VestingWallet. A pool that should be liquid
///         at TGE simply uses duration 0 (fully releasable at its start). No owner, no minting
///         after deployment, no pause, no blacklist.
/// @dev    All vesting math lives in OpenZeppelin's imported VestingWallet; this contract adds no
///         custom vesting logic - only argument forwarding and the supply invariant.
contract ApmFashion is ERC20, ERC20Permit {
    /// @notice Total supply: 10,000,000,000 APM (18 decimals).
    uint256 public constant TOTAL_SUPPLY = 10_000_000_000 * 1e18;

    /// @notice Emitted for each pool's vesting wallet deployed by the constructor.
    event VestingDeployed(
        address indexed beneficiary, address indexed wallet, uint256 amount, uint64 start, uint64 duration
    );

    /// @param beneficiaries Pool wallets (one per allocation pool; the pool redistributes onward).
    /// @param amounts       Token amount per pool.
    /// @param starts        Vesting start per pool (TGE, or TGE + cliff).
    /// @param durations     Linear duration per pool (0 => fully releasable at start).
    constructor(
        address[] memory beneficiaries,
        uint256[] memory amounts,
        uint64[] memory starts,
        uint64[] memory durations
    ) ERC20("apM Fashion", "APM") ERC20Permit("apM Fashion") {
        uint256 n = beneficiaries.length;
        require(n == amounts.length && n == starts.length && n == durations.length, "array length mismatch");

        uint256 minted;
        for (uint256 i = 0; i < n; ++i) {
            require(beneficiaries[i] != address(0), "zero beneficiary");

            VestingWallet wallet = new VestingWallet(beneficiaries[i], starts[i], durations[i]);
            _mint(address(wallet), amounts[i]);
            minted += amounts[i];
            emit VestingDeployed(beneficiaries[i], address(wallet), amounts[i], starts[i], durations[i]);
        }

        require(minted == TOTAL_SUPPLY, "supply != TOTAL_SUPPLY");
    }
}
