// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./CogniToken.sol";
import "./AgentRegistry.sol";

contract SlashManager {
    uint256 public constant BOND = 10 * 10 ** 18;
    uint256 public constant WINDOW = 1 hours;
    uint256 public constant BASE_SLASH = 50 * 10 ** 18;

    CogniToken public immutable token;
    AgentRegistry public immutable registry;

    struct Challenge {
        address challenger;
        address agent;
        bytes32 taskHash;
        uint256 createdAt;
        bool resolved;
    }

    mapping(uint256 => Challenge) public challenges;
    uint256 public nextId;

    event Challenged(uint256 id, address agent, bytes32 taskHash);
    event Resolved(uint256 id, bool slashed);

    error BadBond();
    error Late();
    error Done();

    constructor(CogniToken token_, AgentRegistry registry_) {
        token = token_;
        registry = registry_;
    }

    function challenge(address agent, bytes32 taskHash) external returns (uint256 id) {
        token.transferFrom(msg.sender, address(this), BOND);
        id = nextId++;
        challenges[id] = Challenge(msg.sender, agent, taskHash, block.timestamp, false);
        emit Challenged(id, agent, taskHash);
    }

    /// @param validWork true if agent provided valid PoVT / TEE / counter-proof
    function resolve(uint256 id, bool validWork) external {
        Challenge storage ch = challenges[id];
        if (ch.resolved) revert Done();
        if (block.timestamp > ch.createdAt + WINDOW && validWork) revert Late();
        ch.resolved = true;
        if (validWork) {
            token.transfer(ch.challenger, BOND); // refund if still in window path via authorized resolver
            registry.creditSuccess(ch.agent);
            emit Resolved(id, false);
        } else {
            uint256 slashAmt = BASE_SLASH;
            registry.slash(ch.agent, slashAmt);
            uint256 seized = token.balanceOf(address(this));
            // bond + slashed tokens
            uint256 reward = seized / 2;
            token.transfer(ch.challenger, reward);
            token.burn(seized - reward);
            emit Resolved(id, true);
        }
    }
}
