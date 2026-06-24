// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @notice Fixed-supply, ownerless BEP-20 token. The full supply is minted once in the
///         constructor to the given recipients.
contract ApmFashion is ERC20, ERC20Permit {
    uint256 public constant TOTAL_SUPPLY = 10_000_000_000 * 1e18;

    /// @param recipients Address per allocation (vesting wallet or treasury).
    /// @param amounts    Amount per recipient; must sum to TOTAL_SUPPLY.
    constructor(address[] memory recipients, uint256[] memory amounts)
        ERC20("apM Fashion", "APM")
        ERC20Permit("apM Fashion")
    {
        require(recipients.length == amounts.length, "array length mismatch");

        uint256 minted;
        for (uint256 i = 0; i < recipients.length; ++i) {
            require(recipients[i] != address(0), "zero recipient");
            _mint(recipients[i], amounts[i]);
            minted += amounts[i];
        }
        require(minted == TOTAL_SUPPLY, "supply != TOTAL_SUPPLY");
    }
}
