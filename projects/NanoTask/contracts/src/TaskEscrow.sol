// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ITaskEscrow} from "./interfaces/ITaskEscrow.sol";

interface INano { function transferFrom(address f,address t,uint256 v) external returns(bool); function transfer(address t,uint256 v) external returns(bool); function burn(uint256 v) external; function balanceOf(address a) external view returns(uint256); }

/// @title TaskEscrow — Minimal escrow for NanoTask agents (hardened)
/// @notice Flow: create_task → submit_result → approve | claimTimeout → split 98/1/1
///         Stake required for workers, slash on challenge, EIP-712 gasless submit.
/// @dev <200 lines, no deps, custom errors, reentrancy guard, malleability checks.
contract TaskEscrow is ITaskEscrow {
    INano public immutable TASK;
    address public treasury;
    address public owner;
    uint256 public feeBps = 200; // 2% total, half burn half treasury
    uint256 public minStake = 50 * 1e18;
    uint256 public nextId = 1;
    uint256 public burnedTotal;

    // reentrancy guard
    uint256 private _locked = 1;
    modifier lock() { if (_locked != 1) revert BadStatus(Status.Settled, Status.Open); _locked = 2; _; _locked = 1; }

    mapping(address => uint256) public stakes;
    mapping(uint256 => Task) public tasks;

    bytes32 public constant RESULT_TYPEHASH = keccak256("Result(uint256 taskId,bytes32 resultHash)");
    bytes32 private constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private _cachedDomainSeparator;
    uint256 private _cachedChainId;

    // EIP-2 malleability: secp256k1n /2
    bytes32 private constant HALF_N = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    modifier onlyOwner(){ if(msg.sender!=owner) revert NotClient(); _; }

    constructor(INano task_, address treasury_) {
        if(address(task_)==address(0)||treasury_==address(0)) revert ZeroAddress();
        TASK = task_; treasury = treasury_; owner = msg.sender;
        _cachedChainId = block.chainid;
        _cachedDomainSeparator = _buildDomainSeparator();
    }

    function _buildDomainSeparator() private view returns(bytes32){
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes("NanoTaskEscrow")), keccak256(bytes("1")), block.chainid, address(this)));
    }

    function DOMAIN_SEPARATOR() public view returns(bytes32){
        if (block.chainid == _cachedChainId) return _cachedDomainSeparator;
        return _buildDomainSeparator();
    }

    // ---- stake
    function stake(uint256 amt) external lock {
        if(amt==0) revert ZeroReward();
        // checks-effects-interactions: transfer after state? we must transfer first then update
        TASK.transferFrom(msg.sender, address(this), amt);
        stakes[msg.sender]+=amt;
        emit Staked(msg.sender, amt);
    }
    function unstake(uint256 amt) external lock {
        if(amt==0) revert ZeroReward();
        if(stakes[msg.sender] < amt) revert InsufficientStake();
        stakes[msg.sender]-=amt;
        TASK.transfer(msg.sender, amt);
        emit Unstaked(msg.sender, amt);
    }

    // ---- create
    function createTask(bytes32 inputHash, uint256 reward, uint64 timeoutSec) external lock returns(uint256 id){
        if(reward==0) revert ZeroReward();
        if(inputHash==bytes32(0)) revert ZeroReward(); // require non-zero hash
        if(timeoutSec==0) timeoutSec= 7 days;
        if(timeoutSec < 5 || timeoutSec > 30 days) revert TimeoutNotReached(); // reuse for invalid
        TASK.transferFrom(msg.sender, address(this), reward);
        id = nextId++;
        tasks[id]=Task({client:msg.sender, worker:address(0), inputHash:inputHash, resultHash:bytes32(0), reward:reward, createdAt:uint64(block.timestamp), submittedAt:0, timeout:timeoutSec, status:Status.Open});
        emit TaskCreated(id, msg.sender, inputHash, reward, timeoutSec);
    }

    // ---- submit
    function submitResult(uint256 taskId, bytes32 resultHash) external lock {
        if(resultHash==bytes32(0)) revert ZeroReward();
        Task storage t = tasks[taskId];
        if(t.client==address(0)) revert TaskNotFound();
        if(t.status!=Status.Open) revert BadStatus(t.status, Status.Open);
        if(stakes[msg.sender] < minStake) revert InsufficientStake();
        t.worker = msg.sender; t.resultHash=resultHash; t.submittedAt=uint64(block.timestamp); t.status=Status.Submitted;
        emit ResultSubmitted(taskId, msg.sender, resultHash);
    }

    function submitResultWithSig(uint256 taskId, bytes32 resultHash, address worker, uint8 v, bytes32 r, bytes32 s) external lock {
        if(resultHash==bytes32(0)) revert ZeroReward();
        if(worker==address(0)) revert ZeroAddress();
        if(v!=27 && v!=28) revert NotWorker();
        if(uint256(s) > uint256(HALF_N)) revert NotWorker(); // malleability
        Task storage t = tasks[taskId];
        if(t.client==address(0)) revert TaskNotFound();
        if(t.status!=Status.Open) revert BadStatus(t.status, Status.Open);
        if(stakes[worker] < minStake) revert InsufficientStake();
        bytes32 sh = keccak256(abi.encode(RESULT_TYPEHASH, taskId, resultHash));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), sh));
        address rec = ecrecover(digest, v, r, s);
        if(rec!=worker || rec==address(0)) revert NotWorker();
        t.worker = worker; t.resultHash=resultHash; t.submittedAt=uint64(block.timestamp); t.status=Status.Submitted;
        emit ResultSubmitted(taskId, worker, resultHash);
    }

    // ---- settle helpers
    function _split(uint256 reward) internal view returns(uint256 w, uint256 burn, uint256 tr){
        burn = (reward * feeBps) / 20000; // half of fee
        tr = burn; // symmetric 1% each when fee 2%
        w = reward - burn - tr; // remainder to worker (no dust loss)
    }
    function _settle(uint256 taskId) internal {
        Task storage t = tasks[taskId];
        (uint256 w, uint256 burn, uint256 tr) = _split(t.reward);
        t.status = Status.Settled;
        burnedTotal += burn;
        // effects before interactions
        if(w>0) TASK.transfer(t.worker, w);
        if(tr>0) TASK.transfer(treasury, tr);
        if(burn>0) TASK.burn(burn);
        emit TaskSettled(taskId, t.worker, w, burn, tr);
    }

    // ---- approve / timeout / challenge / cancel
    function approve(uint256 taskId) external lock {
        Task storage t = tasks[taskId];
        if(t.client==address(0)) revert TaskNotFound();
        if(msg.sender!=t.client) revert NotClient();
        if(t.status!=Status.Submitted) revert BadStatus(t.status, Status.Submitted);
        _settle(taskId);
    }
    function claimTimeout(uint256 taskId) external lock {
        Task storage t = tasks[taskId];
        if(t.client==address(0)) revert TaskNotFound();
        if(t.status!=Status.Submitted) revert BadStatus(t.status, Status.Submitted);
        if(msg.sender!=t.worker) revert NotWorker();
        if(block.timestamp < uint256(t.submittedAt) + t.timeout) revert TimeoutNotReached();
        _settle(taskId);
    }
    function challenge(uint256 taskId) external lock {
        Task storage t = tasks[taskId];
        if(t.client==address(0)) revert TaskNotFound();
        if(t.status!=Status.Submitted) revert BadStatus(t.status, Status.Submitted);
        if(msg.sender!=t.client) revert NotClient();
        uint256 sl = stakes[t.worker] >= minStake ? minStake/2 : stakes[t.worker];
        if(sl>0){ stakes[t.worker]-=sl;
            burnedTotal += sl;
            TASK.burn(sl);
        }
        t.status = Status.Slashed;
        TASK.transfer(t.client, t.reward);
        emit TaskSlashed(taskId, t.worker, sl);
    }
    function cancel(uint256 taskId) external lock {
        Task storage t = tasks[taskId];
        if(t.client==address(0)) revert TaskNotFound();
        if(msg.sender!=t.client) revert NotClient();
        if(t.status!=Status.Open) revert BadStatus(t.status, Status.Open);
        if(block.timestamp < uint256(t.createdAt) + t.timeout) revert TimeoutNotExpired();
        t.status = Status.Cancelled;
        TASK.transfer(t.client, t.reward);
        emit TaskCancelled(taskId);
    }

    // ---- views
    function getTask(uint256 id) external view returns(Task memory){ Task memory t=tasks[id]; if(t.client==address(0)) revert TaskNotFound(); return t; }
    function setTreasury(address t) external onlyOwner { if(t==address(0)) revert ZeroAddress(); treasury=t; }
    function setFeeBps(uint256 bps) external onlyOwner { if(bps>500) revert BadStatus(Status.Settled, Status.Open); feeBps=bps; }
}
