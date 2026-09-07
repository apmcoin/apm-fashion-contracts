// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract GenesisClaim is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant ROUND_COUNT = 36;
    uint256 public constant CONVERSION_RATIO = 2;
    uint256 public constant MIN_ROUND_INTERVAL = 28 days;
    uint256 public constant MAX_ROUND_INTERVAL = 31 days;
    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    IERC20 public immutable token;
    bytes32 public immutable merkleRoot;
    uint256 public immutable totalAllocation;

    uint64 public immutable startTimestamp;
    uint64[36] public roundEndTimestamps;
    uint256[36] public roundClaimed;

    uint256 public nextRoundToSettle;

    mapping(uint256 => mapping(address => bool)) public isClaimed;

    error ZeroToken();
    error ZeroMerkleRoot();
    error ZeroAllocation();
    error ClaimWindowClosed();
    error AlreadyClaimed(uint256 round, address account);
    error InvalidProof();
    error ZeroClaimAmount();
    error RoundAllocationExceeded(uint256 round, uint256 claimed, uint256 allocation);

    event Claimed(uint256 indexed round, address indexed account, uint256 amount);
    event RoundSettled(uint256 indexed round, uint256 allocation, uint256 claimed, uint256 sentToDeadAddress);

    constructor(
        IERC20 token_,
        bytes32 merkleRoot_,
        uint64 startTimestamp_,
        uint64[36] memory roundEndTimestamps_,
        uint256 totalAllocation_
    ) {
        if (address(token_) == address(0)) revert ZeroToken();
        if (merkleRoot_ == bytes32(0)) revert ZeroMerkleRoot();
        if (totalAllocation_ == 0) revert ZeroAllocation();

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

        token = token_;
        merkleRoot = merkleRoot_;
        totalAllocation = totalAllocation_;
        startTimestamp = startTimestamp_;
        roundEndTimestamps = roundEndTimestamps_;
    }

    function claim(
        uint256 snapshotBalanceWei,
        bytes32[] calldata merkleProof
    ) external nonReentrant returns (uint256 amount) {
        uint256 round = currentRound();
        if (isClaimed[round][msg.sender]) revert AlreadyClaimed(round, msg.sender);

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, snapshotBalanceWei))));
        if (!MerkleProof.verifyCalldata(merkleProof, merkleRoot, leaf)) revert InvalidProof();

        amount = monthlyAmount(snapshotBalanceWei);
        if (amount == 0) revert ZeroClaimAmount();

        uint256 updatedClaimed = roundClaimed[round] + amount;
        uint256 allocation = _roundAllocation(round);
        if (updatedClaimed > allocation) {
            revert RoundAllocationExceeded(round, updatedClaimed, allocation);
        }

        isClaimed[round][msg.sender] = true;
        roundClaimed[round] = updatedClaimed;

        token.safeTransfer(msg.sender, amount);
        emit Claimed(round, msg.sender, amount);
    }

    function settleExpiredRounds() external nonReentrant returns (uint256 settled, uint256 sentToDeadAddress) {
        uint256 round = nextRoundToSettle;

        while (round < ROUND_COUNT && block.timestamp >= roundEndTimestamps[round]) {
            uint256 allocation = _roundAllocation(round);
            uint256 claimed = roundClaimed[round];
            uint256 unclaimed = allocation - claimed;

            sentToDeadAddress += unclaimed;
            ++settled;
            emit RoundSettled(round, allocation, claimed, unclaimed);
            ++round;
        }

        nextRoundToSettle = round;
        if (sentToDeadAddress != 0) token.safeTransfer(DEAD_ADDRESS, sentToDeadAddress);
    }

    function currentRound() public view returns (uint256) {
        uint256 timestamp = block.timestamp;
        if (timestamp < startTimestamp || timestamp >= roundEndTimestamps[ROUND_COUNT - 1]) {
            revert ClaimWindowClosed();
        }
        return _roundAt(timestamp);
    }

    function monthlyAmount(uint256 snapshotBalanceWei) public pure returns (uint256) {
        // The fixed x2 conversion over 36 rounds is division by 18, without overflow.
        return snapshotBalanceWei / (ROUND_COUNT / CONVERSION_RATIO);
    }

    function _roundAllocation(uint256 round) private view returns (uint256) {
        uint256 baseAmount = totalAllocation / ROUND_COUNT;
        if (round < ROUND_COUNT - 1) return baseAmount;
        return totalAllocation - baseAmount * (ROUND_COUNT - 1);
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
