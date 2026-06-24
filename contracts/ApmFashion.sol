// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {VestingWallet} from "@openzeppelin/contracts/finance/VestingWallet.sol";

/// @notice Fixed-supply, ownerless BEP-20 token. The full supply is minted once in the
///         constructor; each allocation pool is minted into an OpenZeppelin VestingWallet.
contract ApmFashion is ERC20, ERC20Permit {
    uint256 public constant TOTAL_SUPPLY = 10_000_000_000 * 1e18;

    event VestingDeployed(
        address indexed beneficiary, address indexed wallet, uint256 amount, uint64 start, uint64 duration
    );

    /// @param beneficiaries Pool wallet per allocation.
    /// @param amounts       Amount per pool.
    /// @param starts        Vesting start (TGE + cliff).
    /// @param durations     Linear duration (0 = unlocked at start).
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
