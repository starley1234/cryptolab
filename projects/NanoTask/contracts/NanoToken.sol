// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title NanoToken ($TASK) — Fixed-supply ERC-20 for NanoTask
/// @notice Minimalist burn-on-settlement token. No mint after deploy. EIP-2612 permit.
/// @dev Self-contained, no external deps. Custom errors for gas.
contract NanoToken {
    string public constant name = "NanoTask";
    string public constant symbol = "TASK";
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
    error InsufficientBalance(uint256 have, uint256 need);
    error InsufficientAllowance(uint256 have, uint256 need);
    error PermitExpired(uint256 deadline, uint256 now_);
    error PermitInvalidSigner(address recovered, address owner);
    error PermitInvalidSignature();

    bytes32 public constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(name)), keccak256(bytes("1")), block.chainid, address(this)));
    }

    constructor(address treasury) {
        if (treasury == address(0)) revert InvalidReceiver();
        totalSupply = MAX_SUPPLY;
        balanceOf[treasury] = MAX_SUPPLY;
        emit Transfer(address(0), treasury, MAX_SUPPLY);
    }

    function transfer(address to, uint256 v) public returns (bool) { _transfer(msg.sender, to, v); return true; }

    function transferFrom(address from, address to, uint256 v) public returns (bool) {
        uint256 al = allowance[from][msg.sender];
        if (al < v) revert InsufficientAllowance(al, v);
        if (al != type(uint256).max) {
            allowance[from][msg.sender] = al - v;
            emit Approval(from, msg.sender, al - v);
        }
        _transfer(from, to, v);
        return true;
    }

    function approve(address sp, uint256 v) public returns (bool) {
        if (sp == address(0)) revert InvalidReceiver();
        allowance[msg.sender][sp] = v;
        emit Approval(msg.sender, sp, v);
        return true;
    }

    function burn(uint256 v) external {
        uint256 b = balanceOf[msg.sender];
        if (b < v) revert InsufficientBalance(b, v);
        unchecked { balanceOf[msg.sender] = b - v; totalSupply -= v; }
        emit Transfer(msg.sender, address(0), v);
        emit Burned(msg.sender, v);
    }

    function burnFrom(address from, uint256 v) external {
        uint256 al = allowance[from][msg.sender];
        if (al < v) revert InsufficientAllowance(al, v);
        if (al != type(uint256).max) allowance[from][msg.sender] = al - v;
        uint256 b = balanceOf[from];
        if (b < v) revert InsufficientBalance(b, v);
        unchecked { balanceOf[from] = b - v; totalSupply -= v; }
        emit Transfer(from, address(0), v);
        emit Burned(from, v);
    }

    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external {
        if (block.timestamp > deadline) revert PermitExpired(deadline, block.timestamp);
        bytes32 sh = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces[owner], deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), sh));
        address rec = ecrecover(digest, v, r, s);
        if (rec == address(0)) revert PermitInvalidSignature();
        if (rec != owner) revert PermitInvalidSigner(rec, owner);
        nonces[owner] += 1;
        allowance[owner][spender] = value;
        emit Approval(owner, spender, value);
    }

    function _transfer(address from, address to, uint256 v) internal {
        if (from == address(0)) revert InvalidSender();
        if (to == address(0)) revert InvalidReceiver();
        uint256 fb = balanceOf[from];
        if (fb < v) revert InsufficientBalance(fb, v);
        unchecked { balanceOf[from] = fb - v; balanceOf[to] += v; }
        emit Transfer(from, to, v);
    }
}
