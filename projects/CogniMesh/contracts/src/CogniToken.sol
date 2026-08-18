// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title CogniMesh Token ($COGNI)
/// @notice Fixed-supply ERC-20. No mint. Burn used by stream/slash/flash fees.
contract CogniToken {
    string public constant name = "CogniMesh";
    string public constant symbol = "COGNI";
    uint8 public constant decimals = 18;
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 10 ** 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public nonces;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Burned(address indexed account, uint256 value);

    error InvalidSender();
    error InvalidReceiver();
    error InsufficientBalance(uint256 available, uint256 needed);
    error InsufficientAllowance(uint256 available, uint256 needed);
    error PermitExpired(uint256 deadline, uint256 now_);
    error PermitInvalidSigner(address recovered, address owner);
    error PermitInvalidSignature();

    bytes32 public constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    bytes32 private constant _DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(
            abi.encode(_DOMAIN_TYPEHASH, keccak256(bytes(name)), keccak256(bytes("1")), block.chainid, address(this))
        );
    }

    constructor(address treasury) {
        if (treasury == address(0)) revert InvalidReceiver();
        totalSupply = MAX_SUPPLY;
        balanceOf[treasury] = MAX_SUPPLY;
        emit Transfer(address(0), treasury, MAX_SUPPLY);
    }

    function transfer(address to, uint256 value) public returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) public returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < value) revert InsufficientAllowance(allowed, value);
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - value;
            emit Approval(from, msg.sender, allowed - value);
        }
        _transfer(from, to, value);
        return true;
    }

    function approve(address spender, uint256 value) public returns (bool) {
        if (spender == address(0)) revert InvalidReceiver();
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function burn(uint256 value) external {
        _burn(msg.sender, value);
    }

    function burnFrom(address from, uint256 value) external {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < value) revert InsufficientAllowance(allowed, value);
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - value;
        }
        _burn(from, value);
    }

    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
    {
        if (block.timestamp > deadline) revert PermitExpired(deadline, block.timestamp);
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces[owner], deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
        address recovered = ecrecover(digest, v, r, s);
        if (recovered == address(0)) revert PermitInvalidSignature();
        if (recovered != owner) revert PermitInvalidSigner(recovered, owner);
        nonces[owner] += 1;
        allowance[owner][spender] = value;
        emit Approval(owner, spender, value);
    }

    function _transfer(address from, address to, uint256 value) internal {
        if (from == address(0)) revert InvalidSender();
        if (to == address(0)) revert InvalidReceiver();
        uint256 fromBalance = balanceOf[from];
        if (fromBalance < value) revert InsufficientBalance(fromBalance, value);
        unchecked {
            balanceOf[from] = fromBalance - value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
    }

    function _burn(address from, uint256 value) internal {
        uint256 fromBalance = balanceOf[from];
        if (fromBalance < value) revert InsufficientBalance(fromBalance, value);
        unchecked {
            balanceOf[from] = fromBalance - value;
            totalSupply -= value;
        }
        emit Transfer(from, address(0), value);
        emit Burned(from, value);
    }
}
