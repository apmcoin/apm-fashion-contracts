// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {VestingWallet} from "@openzeppelin/contracts/finance/VestingWallet.sol";

/// @title apM Fashion
/// @notice Fixed-supply, ownerless, immutable BEP-20 token. A standard ERC20 with no transfer
///         restrictions. The constructor mints the entire supply once, in a single transaction:
///         locked tranches are minted into freshly deployed OpenZeppelin VestingWallet instances;
///         free tranches are minted directly to the given addresses. No owner, no minting after
///         deployment, no pause, no blacklist, no metadata setter.
/// @dev    All vesting math lives in OpenZeppelin's imported VestingWallet. This contract adds no
///         custom vesting logic - only argument forwarding and the supply invariant.
contract ApmFashion is ERC20, ERC20Permit {
    /// @notice Total supply: 10,000,000,000 APM (18 decimals).
    uint256 public constant TOTAL_SUPPLY = 10_000_000_000 * 1e18;

    /// @notice Emitted for each vesting wallet deployed by the constructor.
    event VestingDeployed(
        address indexed beneficiary,
        address indexed wallet,
        uint256 amount,
        uint64 start,
        uint64 duration
    );

    /// @param lockBeneficiaries Beneficiaries (cold wallets) of locked tranches.
    /// @param lockAmounts       Token amount per locked tranche.
    /// @param lockStarts        Vesting start timestamp per tranche (cliff = start offset from TGE).
    /// @param lockDurations     Linear duration per tranche (0 => full unlock at start).
    /// @param freeRecipients    Recipients of immediately-liquid tranches (e.g. exchange).
    /// @param freeAmounts       Token amount per free tranche.
    constructor(
        address[] memory lockBeneficiaries,
        uint256[] memory lockAmounts,
        uint64[] memory lockStarts,
        uint64[] memory lockDurations,
        address[] memory freeRecipients,
        uint256[] memory freeAmounts
    ) ERC20("apM Fashion", "APM") ERC20Permit("apM Fashion") {
        uint256 n = lockBeneficiaries.length;
        require(
            n == lockAmounts.length && n == lockStarts.length && n == lockDurations.length,
            "lock arrays length mismatch"
        );
        require(freeRecipients.length == freeAmounts.length, "free arrays length mismatch");

        uint256 minted;

        for (uint256 i = 0; i < n; ++i) {
            require(lockAmounts[i] != 0, "zero lock amount");
            require(lockStarts[i] >= block.timestamp, "start in past");

            // VestingWallet is OpenZeppelin's audited contract (imported, not custom code).
            // beneficiary == address(0) is rejected by OZ Ownable inside VestingWallet.
            VestingWallet wallet =
                new VestingWallet(lockBeneficiaries[i], lockStarts[i], lockDurations[i]);

            _mint(address(wallet), lockAmounts[i]);
            minted += lockAmounts[i];

            emit VestingDeployed(
                lockBeneficiaries[i], address(wallet), lockAmounts[i], lockStarts[i], lockDurations[i]
            );
        }

        for (uint256 i = 0; i < freeRecipients.length; ++i) {
            require(freeAmounts[i] != 0, "zero free amount");
            _mint(freeRecipients[i], freeAmounts[i]); // zero address rejected by OZ _mint
            minted += freeAmounts[i];
        }

        require(minted == TOTAL_SUPPLY, "supply != TOTAL_SUPPLY");
    }
}
