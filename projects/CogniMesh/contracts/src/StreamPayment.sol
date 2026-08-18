// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./CogniToken.sol";

/// @title Bidirectional voucher channels for sub-cent A2A streams.
contract StreamPayment {
    uint256 public constant TIMEOUT = 1 days;
    uint16 public constant BPS_PROVIDER = 7000;
    uint16 public constant BPS_TREASURY = 2000;
    uint16 public constant BPS_BURN = 1000;

    CogniToken public immutable token;
    address public immutable treasury;

    struct Channel {
        address payer;
        address provider;
        uint256 deposit;
        uint256 settled;
        uint256 openedAt;
        bool open;
    }

    mapping(bytes32 => Channel) public channels;
    uint256 public burnedTotal;

    event Opened(bytes32 indexed id, address payer, address provider, uint256 deposit);
    event Settled(bytes32 indexed id, uint256 amount, uint256 burn);
    event Closed(bytes32 indexed id);

    error ChannelExists();
    error ChannelClosed();
    error BadSig();
    error TooMuch();
    error NotParty();

    constructor(CogniToken token_, address treasury_) {
        token = token_;
        treasury = treasury_;
    }

    function channelId(address payer, address provider, uint256 nonce) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(payer, provider, nonce));
    }

    function open(address provider, uint256 deposit, uint256 nonce) external returns (bytes32 id) {
        id = channelId(msg.sender, provider, nonce);
        if (channels[id].openedAt != 0) revert ChannelExists();
        token.transferFrom(msg.sender, address(this), deposit);
        channels[id] = Channel(msg.sender, provider, deposit, 0, block.timestamp, true);
        emit Opened(id, msg.sender, provider, deposit);
    }

    /// @dev both parties sign keccak256(id, amount)
    function settle(bytes32 id, uint256 amount, uint8 vPayer, bytes32 rPayer, bytes32 sPayer, uint8 vProv, bytes32 rProv, bytes32 sProv)
        external
    {
        Channel storage c = channels[id];
        if (!c.open) revert ChannelClosed();
        if (amount > c.deposit) revert TooMuch();
        if (amount < c.settled) revert TooMuch();
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", keccak256(abi.encode(id, amount))));
        if (ecrecover(digest, vPayer, rPayer, sPayer) != c.payer) revert BadSig();
        if (ecrecover(digest, vProv, rProv, sProv) != c.provider) revert BadSig();
        uint256 delta = amount - c.settled;
        c.settled = amount;
        _split(c.provider, delta);
        emit Settled(id, amount, (delta * BPS_BURN) / 10_000);
    }

    function timeoutClose(bytes32 id) external {
        Channel storage c = channels[id];
        if (!c.open) revert ChannelClosed();
        if (msg.sender != c.payer && msg.sender != c.provider) revert NotParty();
        if (block.timestamp < c.openedAt + TIMEOUT) revert ChannelClosed();
        uint256 leftover = c.deposit - c.settled;
        c.open = false;
        if (leftover > 0) token.transfer(c.payer, leftover);
        emit Closed(id);
    }

    function _split(address provider, uint256 amount) internal {
        uint256 toProv = (amount * BPS_PROVIDER) / 10_000;
        uint256 toTreas = (amount * BPS_TREASURY) / 10_000;
        uint256 toBurn = amount - toProv - toTreas;
        token.transfer(provider, toProv);
        token.transfer(treasury, toTreas);
        token.burn(toBurn);
        burnedTotal += toBurn;
    }
}
