// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./CogniToken.sol";
import "./AgentRegistry.sol";

interface IFlashBorrower {
    function onFlashCompute(uint256 amount, uint256 fee, bytes calldata data) external;
}

/// @title Uncollateralized micro-credit bounded by on-chain reputation.
contract FlashCompute {
    uint16 public constant FEE_BPS = 30; // 0.30%
    CogniToken public immutable token;
    AgentRegistry public immutable registry;
    address public immutable treasury;

    mapping(address => bool) private locked;

    event Flash(address indexed agent, uint256 amount, uint256 fee);

    error NotAgent();
    error OverLimit();
    error Unpaid();
    error Reenter();

    constructor(CogniToken token_, AgentRegistry registry_, address treasury_) {
        token = token_;
        registry = registry_;
        treasury = treasury_;
    }

    function borrow(uint256 amount, bytes calldata data) external {
        if (locked[msg.sender]) revert Reenter();
        (,,,, bool registered) = _agent(msg.sender);
        if (!registered) revert NotAgent();
        uint256 limit = registry.creditLimit(msg.sender);
        if (amount > limit) revert OverLimit();
        uint256 fee = (amount * FEE_BPS) / 10_000;
        locked[msg.sender] = true;
        uint256 before = token.balanceOf(address(this));
        token.transfer(msg.sender, amount);
        IFlashBorrower(msg.sender).onFlashCompute(amount, fee, data);
        uint256 afterBal = token.balanceOf(address(this));
        if (afterBal < before + fee) revert Unpaid();
        locked[msg.sender] = false;
        uint256 burnAmt = fee / 2;
        uint256 treasAmt = fee - burnAmt;
        token.burn(burnAmt);
        token.transfer(treasury, treasAmt);
        emit Flash(msg.sender, amount, fee);
    }

    function _agent(address a) internal view returns (bytes32, bytes32, uint256, uint256, bool) {
        return registry.agents(a);
    }
}
