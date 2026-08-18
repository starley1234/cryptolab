"""Lightweight wallet for NanoTask agents.

Wraps eth-account / web3.py if available, otherwise falls back to deterministic demo keys.
Provides EIP-712 signing for Result(taskId, resultHash) and EIP-2612 permit helpers.
"""
from __future__ import annotations

import hashlib
import os
import json

try:
    from eth_account import Account as EthAccount  # type: ignore
    from eth_account.messages import encode_typed_data  # type: ignore
    HAS_ETH = True
except Exception:
    HAS_ETH = False

DOMAIN_NAME = "NanoTaskEscrow"
DOMAIN_VERSION = "1"
RESULT_TYPE = "Result(uint256 taskId,bytes32 resultHash)"


def keccak(text: str) -> str:
    # demo: sha256 hex instead of keccak256; real contracts use keccak256
    return hashlib.sha256(text.encode()).hexdigest()


class Wallet:
    """Deterministic demo wallet. Use from_mnemonic / from_private_key in prod."""

    def __init__(self, address: str, private_key: str | None = None):
        self.address = address
        self.private_key = private_key or "demo:" + address
        self._eth_acct = None
        if HAS_ETH and private_key and private_key.startswith("0x") and len(private_key) == 66:
            try:
                self._eth_acct = EthAccount.from_key(private_key)
                self.address = self._eth_acct.address
            except Exception:
                pass

    @classmethod
    def random(cls) -> "Wallet":
        raw = os.urandom(20).hex()
        addr = "0x" + raw[:40]
        return cls(addr, "0x" + os.urandom(32).hex())

    @classmethod
    def from_private_key(cls, pk: str) -> "Wallet":
        if HAS_ETH:
            acct = EthAccount.from_key(pk)
            return cls(acct.address, pk)
        return cls("0x" + hashlib.sha256(pk.encode()).hexdigest()[:40], pk)

    def sign_result(self, task_id: int, result_hash: str, chain_id: int = 31337, escrow: str = "0x0000000000000000000000000000000000000001"):
        """Sign Result(taskId, resultHash) per EIP-712. Returns (v,r,s) + digest."""
        digest_hex = keccak(f"{task_id}:{result_hash}:{chain_id}:{escrow}")
        if HAS_ETH and self._eth_acct:
            # real EIP-712 would use encode_typed_data
            msg = encode_typed_data(full_message={
                "domain": {"name": DOMAIN_NAME, "version": DOMAIN_VERSION, "chainId": chain_id, "verifyingContract": escrow},
                "types": {"Result": [{"name": "taskId", "type": "uint256"}, {"name": "resultHash", "type": "bytes32"}],
                          "EIP712Domain": [{"name": "name","type":"string"},{"name":"version","type":"string"},{"name":"chainId","type":"uint256"},{"name":"verifyingContract","type":"address"}]},
                "primaryType": "Result",
                "message": {"taskId": task_id, "resultHash": result_hash},
            })
            signed = self._eth_acct.sign_message(msg)
            return {"digest": "0x"+digest_hex, "v": signed.v, "r": hex(signed.r), "s": hex(signed.s), "signature": signed.signature.hex()}
        # demo fallback
        sig = hashlib.sha256((digest_hex + self.address + self.private_key).encode()).hexdigest()
        return {"digest": "0x"+digest_hex, "v": 27, "r": "0x"+sig[:64], "s": "0x"+sig[64:128], "signature": "0x"+sig[:130]}

    def sign_permit(self, owner: str, spender: str, value: int, nonce: int, deadline: int):
        """EIP-2612 permit digest helper."""
        digest = keccak(f"Permit:{owner}:{spender}:{value}:{nonce}:{deadline}")
        sig = hashlib.sha256((digest + self.private_key).encode()).hexdigest()
        return {"digest": "0x"+digest, "v": 27, "r": "0x"+sig[:64], "s": "0x"+sig[64:128], "signature": "0x"+sig[:130]}

    def __repr__(self):
        return f"<Wallet {self.address[:10]}…>"
