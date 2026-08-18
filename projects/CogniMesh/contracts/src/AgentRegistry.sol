// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./CogniToken.sol";

/// @title On-chain identity + stake + reputation for AI agents.
contract AgentRegistry {
    uint256 public constant REPUTATION_SCALE = 1e6;
    uint256 public constant MIN_STAKE = 100 * 10 ** 18;
    uint256 public constant MAX_REPUTATION = 10e6;

    CogniToken public immutable token;

    struct Agent {
        bytes32 did;
        bytes32 endpointHash;
        uint256 stake;
        uint256 reputation;
        bool registered;
    }

    mapping(address => Agent) public agents;
    address public slashManager;

    event Registered(address indexed agent, bytes32 did, uint256 stake);
    event StakeAdded(address indexed agent, uint256 amount);
    event Unstaked(address indexed agent, uint256 amount);
    event ReputationChanged(address indexed agent, uint256 reputation);
    event Slashed(address indexed agent, uint256 amount);

    error AlreadyRegistered();
    error NotRegistered();
    error StakeTooLow();
    error Unauthorized();
    error InsufficientStake();

    constructor(CogniToken token_) {
        token = token_;
    }

    function setSlashManager(address m) external {
        if (slashManager != address(0)) revert Unauthorized();
        slashManager = m;
    }

    function register(bytes32 did, bytes32 endpointHash, uint256 stake) external {
        if (agents[msg.sender].registered) revert AlreadyRegistered();
        if (stake < MIN_STAKE) revert StakeTooLow();
        token.transferFrom(msg.sender, address(this), stake);
        agents[msg.sender] = Agent({
            did: did,
            endpointHash: endpointHash,
            stake: stake,
            reputation: REPUTATION_SCALE,
            registered: true
        });
        emit Registered(msg.sender, did, stake);
    }

    function addStake(uint256 amount) external {
        if (!agents[msg.sender].registered) revert NotRegistered();
        token.transferFrom(msg.sender, address(this), amount);
        agents[msg.sender].stake += amount;
        emit StakeAdded(msg.sender, amount);
    }

    function unstake(uint256 amount) external {
        Agent storage a = agents[msg.sender];
        if (!a.registered) revert NotRegistered();
        if (a.stake - amount < MIN_STAKE) revert StakeTooLow();
        a.stake -= amount;
        token.transfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    function creditSuccess(address agent) external {
        if (msg.sender != slashManager) revert Unauthorized();
        Agent storage a = agents[agent];
        if (!a.registered) revert NotRegistered();
        uint256 next = a.reputation + 1_000;
        if (next > MAX_REPUTATION) next = MAX_REPUTATION;
        a.reputation = next;
        emit ReputationChanged(agent, next);
    }

    function slash(address agent, uint256 amount) external {
        if (msg.sender != slashManager) revert Unauthorized();
        Agent storage a = agents[agent];
        if (!a.registered) revert NotRegistered();
        if (amount > a.stake) amount = a.stake;
        a.stake -= amount;
        uint256 next = a.reputation > 50_000 ? a.reputation - 50_000 : 1;
        a.reputation = next;
        emit Slashed(agent, amount);
        emit ReputationChanged(agent, next);
        // tokens stay in registry until slash manager pulls via pullSlash
        token.transfer(slashManager, amount);
    }

    function creditLimit(address agent) external view returns (uint256) {
        Agent storage a = agents[agent];
        if (!a.registered) return 0;
        return (a.reputation * a.stake) / REPUTATION_SCALE;
    }
}
