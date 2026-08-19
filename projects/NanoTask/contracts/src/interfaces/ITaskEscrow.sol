// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ITaskEscrow — Minimal A2A escrow for autonomous agents
interface ITaskEscrow {
    enum Status { Open, Submitted, Settled, Slashed, Cancelled }

    struct Task {
        address client;
        address worker;
        bytes32 inputHash;
        bytes32 resultHash;
        uint256 reward;
        uint64 createdAt;
        uint64 submittedAt;
        uint64 timeout;
        Status status;
    }

    event TaskCreated(uint256 indexed id, address indexed client, bytes32 inputHash, uint256 reward, uint64 timeout);
    event ResultSubmitted(uint256 indexed id, address indexed worker, bytes32 resultHash);
    event TaskSettled(uint256 indexed id, address indexed worker, uint256 workerAmt, uint256 burnAmt, uint256 treasuryAmt);
    event TaskSlashed(uint256 indexed id, address indexed worker, uint256 slashed);
    event TaskCancelled(uint256 indexed id);
    event Staked(address indexed worker, uint256 amount);
    event Unstaked(address indexed worker, uint256 amount);

    error InsufficientStake();
    error NotClient();
    error NotWorker();
    error BadStatus(Status have, Status want);
    error TimeoutNotReached();
    error TimeoutNotExpired();
    error ZeroReward();
    error ZeroAddress();
    error InsufficientAllowance();
    error TaskNotFound();

    function stake(uint256 amount) external;
    function unstake(uint256 amount) external;
    function createTask(bytes32 inputHash, uint256 reward, uint64 timeoutSec) external returns (uint256 id);
    function submitResult(uint256 taskId, bytes32 resultHash) external;
    function submitResultWithSig(uint256 taskId, bytes32 resultHash, address worker, uint8 v, bytes32 r, bytes32 s) external;
    function approve(uint256 taskId) external;
    function claimTimeout(uint256 taskId) external;
    function challenge(uint256 taskId) external;
    function cancel(uint256 taskId) external;
    function getTask(uint256 taskId) external view returns (Task memory);
}
