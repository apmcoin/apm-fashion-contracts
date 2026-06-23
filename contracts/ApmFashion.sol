// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title apM Fashion
/// @notice Fixed-supply, ownerless, immutable BEP-20 token.
///         No mint after construction, no pause, no ban, no metadata setter.
contract ApmFashion is ERC20, ERC20Permit {
    /// @notice Total supply: 10,000,000,000 APM (18 decimals).
    uint256 public constant TOTAL_SUPPLY = 10_000_000_000 * 1e18;

    /// @param recipients Allocation targets (vesting contracts or cold-wallet EOAs).
    /// @param amounts    Amount per target; sum MUST equal TOTAL_SUPPLY.
    constructor(address[] memory recipients, uint256[] memory amounts)
        ERC20("apM Fashion", "APM")
        ERC20Permit("apM Fashion")
    {
        require(recipients.length == amounts.length, "len: recipients != amounts");
        require(recipients.length != 0, "empty allocation");

        uint256 minted;
        for (uint256 i = 0; i < recipients.length; ++i) {
            require(amounts[i] != 0, "zero amount entry"); // zero address is blocked by OZ _mint
            _mint(recipients[i], amounts[i]);
            minted += amounts[i]; // 0.8.x checked arithmetic reverts on overflow
        }
        require(minted == TOTAL_SUPPLY, "supply != TOTAL_SUPPLY");
    }
}
