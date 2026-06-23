// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {VestingWallet} from "@openzeppelin/contracts/finance/VestingWallet.sol";

/// @title CliffVestingWallet
/// @notice Cliff-then-linear vesting. Schedule is fully set via deploy args.
///         owner == beneficiary (no privileged control lever; schedule is immutable).
contract CliffVestingWallet is VestingWallet {
    uint64 private immutable _cliff;

    /// @param beneficiary     Recipient (cold wallet). Zero address is blocked by OZ Ownable.
    /// @param startTimestamp  Vesting start (use a future TGE time).
    /// @param durationSeconds Total duration. 0 => pure timelock that unlocks all at start.
    /// @param cliffSeconds    Cliff length from start; must be <= durationSeconds.
    constructor(
        address beneficiary,
        uint64 startTimestamp,
        uint64 durationSeconds,
        uint64 cliffSeconds
    ) VestingWallet(beneficiary, startTimestamp, durationSeconds) {
        require(startTimestamp >= block.timestamp, "start in past"); // avoid accidental instant unlock
        require(cliffSeconds <= durationSeconds, "cliff > duration");
        _cliff = startTimestamp + cliffSeconds;
    }

    /// @notice Cliff end timestamp.
    function cliff() external view returns (uint256) {
        return _cliff;
    }

    /// @dev Nothing vests before the cliff; linear afterwards (OZ default).
    function _vestingSchedule(uint256 totalAllocation, uint64 timestamp)
        internal
        view
        override
        returns (uint256)
    {
        if (timestamp < _cliff) {
            return 0;
        }
        return super._vestingSchedule(totalAllocation, timestamp);
    }
}
