// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {BitMaps} from "@openzeppelin/contracts/utils/structs/BitMaps.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract GenesisClaim is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using BitMaps for BitMaps.BitMap;

    uint256 public constant ROUND_COUNT = 36;
    uint256 public constant MIN_ROUND_INTERVAL = 28 days;
    uint256 public constant MAX_ROUND_INTERVAL = 31 days;
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    IERC20 public immutable token;
    bytes32 public immutable merkleRoot;

    uint64 public immutable startTimestamp;
    uint64[36] public roundEndTimestamps;
    uint256[36] public roundAllocations;
    uint256[36] public roundClaimed;

    uint256 public nextRoundToSettle;

    BitMaps.BitMap[36] private _claimedByRound;

    error ZeroToken();
    error ZeroMerkleRoot();
    error ZeroAccount();
    error InvalidRound(uint256 round);
    error ClaimWindowClosed();
    error AlreadyClaimed(uint256 round, uint256 index);
    error InvalidProof();
    error ZeroClaimAmount();
    error ZeroRoundAllocation(uint256 round);
    error RoundAllocationExceeded(uint256 round, uint256 claimed, uint256 allocation);

    event Claimed(uint256 indexed round, uint256 indexed index, address indexed account, uint256 amount);
    event RoundSettled(uint256 indexed round, uint256 allocation, uint256 claimed, uint256 burned);

    constructor(
        IERC20 token_,
        bytes32 merkleRoot_,
        uint64 startTimestamp_,
        uint64[36] memory roundEndTimestamps_,
        uint256[36] memory roundAllocations_
    ) {
        if (address(token_) == address(0)) revert ZeroToken();
        if (merkleRoot_ == bytes32(0)) revert ZeroMerkleRoot();

        require(startTimestamp_ >= block.timestamp, "start in past");
        require(roundEndTimestamps_[0] > startTimestamp_, "invalid first round end");
        uint256 firstInterval = roundEndTimestamps_[0] - startTimestamp_;
        require(firstInterval >= MIN_ROUND_INTERVAL, "first interval too short");
        require(firstInterval <= MAX_ROUND_INTERVAL, "first interval too long");
        for (uint256 i = 1; i < ROUND_COUNT; ++i) {
            require(roundEndTimestamps_[i] > roundEndTimestamps_[i - 1], "round ends not increasing");
            uint256 interval = roundEndTimestamps_[i] - roundEndTimestamps_[i - 1];
            require(interval >= MIN_ROUND_INTERVAL, "round interval too short");
            require(interval <= MAX_ROUND_INTERVAL, "round interval too long");
        }

        for (uint256 i = 0; i < ROUND_COUNT; ++i) {
            if (roundAllocations_[i] == 0) revert ZeroRoundAllocation(i);
            roundEndTimestamps[i] = roundEndTimestamps_[i];
            roundAllocations[i] = roundAllocations_[i];
        }

        token = token_;
        merkleRoot = merkleRoot_;
        startTimestamp = startTimestamp_;
    }

    function claim(
        uint256 index,
        address account,
        uint256 totalEntitlement,
        bytes32[] calldata merkleProof
    ) external nonReentrant returns (uint256 amount) {
        if (account == address(0)) revert ZeroAccount();

        uint256 round = currentRound();
        if (_claimedByRound[round].get(index)) revert AlreadyClaimed(round, index);

        bytes32 leaf = leafHash(index, account, totalEntitlement);
        if (!MerkleProof.verifyCalldata(merkleProof, merkleRoot, leaf)) revert InvalidProof();

        amount = roundAmount(totalEntitlement, round);
        if (amount == 0) revert ZeroClaimAmount();

        uint256 updatedClaimed = roundClaimed[round] + amount;
        uint256 allocation = roundAllocations[round];
        if (updatedClaimed > allocation) {
            revert RoundAllocationExceeded(round, updatedClaimed, allocation);
        }

        _claimedByRound[round].set(index);
        roundClaimed[round] = updatedClaimed;

        token.safeTransfer(account, amount);
        emit Claimed(round, index, account, amount);
    }

    function settleExpiredRounds() external nonReentrant returns (uint256 settled, uint256 burned) {
        uint256 round = nextRoundToSettle;

        while (round < ROUND_COUNT && block.timestamp >= roundEndTimestamps[round]) {
            uint256 allocation = roundAllocations[round];
            uint256 claimed = roundClaimed[round];
            uint256 unclaimed = allocation - claimed;

            burned += unclaimed;
            ++settled;
            emit RoundSettled(round, allocation, claimed, unclaimed);
            ++round;
        }

        nextRoundToSettle = round;
        if (burned != 0) token.safeTransfer(BURN_ADDRESS, burned);
    }

    function currentRound() public view returns (uint256) {
        uint256 timestamp = block.timestamp;
        if (timestamp < startTimestamp || timestamp >= roundEndTimestamps[ROUND_COUNT - 1]) {
            revert ClaimWindowClosed();
        }
        return _roundAt(timestamp);
    }

    function roundAmount(uint256 totalEntitlement, uint256 round) public pure returns (uint256) {
        if (round >= ROUND_COUNT) revert InvalidRound(round);
        uint256 baseAmount = totalEntitlement / ROUND_COUNT;
        if (round < ROUND_COUNT - 1) return baseAmount;
        return totalEntitlement - baseAmount * (ROUND_COUNT - 1);
    }

    function isClaimed(uint256 round, uint256 index) external view returns (bool) {
        if (round >= ROUND_COUNT) revert InvalidRound(round);
        return _claimedByRound[round].get(index);
    }

    function leafHash(uint256 index, address account, uint256 totalEntitlement) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(index, account, totalEntitlement))));
    }

    function _roundAt(uint256 timestamp) private view returns (uint256) {
        uint256 low;
        uint256 high = ROUND_COUNT;

        while (low < high) {
            uint256 mid = (low + high) / 2;
            if (timestamp < roundEndTimestamps[mid]) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }
        return low;
    }
}
