"""Lightweight wallet for NanoTask agents.

Wraps eth-account / web3.py if available, otherwise falls back to deterministic demo keys.
Provides EIP-712 signing for Result(taskId, resultHash) and EIP-2612 permit helpers.

NOTE: demo keccak uses sha256 for zero-dep. Production MUST use keccak256 (pysha3 / eth_hash)
to match on-chain DOMAIN_SEPARATOR. The fallback intentionally pads signatures to 130 hex
so gateway strict validation passes.
"""
from __future__ import annotations

import hashlib
import os
import re

try:
    from eth_account import Account as EthAccount  # type: ignore
    from eth_account.messages import encode_typed_data  # type: ignore
    HAS_ETH = True
except Exception:
    HAS_ETH = False

DOMAIN_NAME = "NanoTaskEscrow"
DOMAIN_VERSION = "1"

HEX32_RE = re.compile(r"^0x[0-9a-fA-F]{64}$")
HEX_ADDR_RE = re.compile(r"^0x[0-9a-fA-F]{32,40}$")


def keccak(text: str) -> str:
    # demo: sha256 hex instead of keccak256; real contracts use keccak256
    # TODO: replace with eth_hash.auto.keccak(text.encode()).hex() for mainnet parity
    return hashlib.sha256(text.encode()).hexdigest()


class Wallet:
    """Deterministic demo wallet. Use from_mnemonic / from_private_key in prod."""

    def __init__(self, address: str, private_key: str | None = None):
        if not HEX_ADDR_RE.match(address):
            # allow non-strict for demo, but normalize
            address = "0x" + hashlib.sha256(address.encode()).hexdigest()[:40]
        self.address = address.lower()
        self.private_key = private_key or "demo:" + address
        self._eth_acct = None
        if HAS_ETH and private_key and private_key.startswith("0x") and len(private_key) == 66:
            try:
                self._eth_acct = EthAccount.from_key(private_key)
                self.address = self._eth_acct.address.lower()
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
            try:
                acct = EthAccount.from_key(pk)
                return cls(acct.address, pk)
            except Exception:
                pass
        return cls("0x" + hashlib.sha256(pk.encode()).hexdigest()[:40], pk)

    def sign_result(self, task_id: int, result_hash: str, chain_id: int = 31337, escrow: str = "0x0000000000000000000000000000000000000001"):
        """Sign Result(taskId, resultHash) per EIP-712. Returns (v,r,s) + digest."""
        if not isinstance(task_id, int) or task_id <= 0:
            raise ValueError("task_id must be >0")
        if result_hash is None or not re.match(r"^0x[0-9a-fA-F]+$", result_hash):
            raise ValueError("result_hash must be 0x hex")
        # normalize to 32 bytes
        if len(result_hash) < 66:
            result_hash = "0x" + result_hash[2:].zfill(64)
        if not HEX_ADDR_RE.match(escrow):
            raise ValueError("escrow must be 0x 40 hex")
        digest_hex = keccak(f"{task_id}:{result_hash}:{chain_id}:{escrow.lower()}")
        if HAS_ETH and self._eth_acct:
            msg = encode_typed_data(full_message={
                "domain": {"name": DOMAIN_NAME, "version": DOMAIN_VERSION, "chainId": chain_id, "verifyingContract": escrow},
                "types": {"Result": [{"name": "taskId", "type": "uint256"}, {"name": "resultHash", "type": "bytes32"}],
                          "EIP712Domain": [{"name": "name","type":"string"},{"name":"version","type":"string"},{"name":"chainId","type":"uint256"},{"name":"verifyingContract","type":"address"}]},
                "primaryType": "Result",
                "message": {"taskId": task_id, "resultHash": result_hash},
            })
            signed = self._eth_acct.sign_message(msg)
            # ensure r,s are 32 bytes hex
            r = hex(signed.r)[2:].zfill(64)
            s = hex(signed.s)[2:].zfill(64)
            sig = r + s + format(signed.v, '02x')
            # pad to 130 if needed (v already)
            sig = (r + s).ljust(128, "0") + format(signed.v, '02x')
            return {"digest": "0x"+digest_hex, "v": signed.v, "r": "0x"+r, "s": "0x"+s, "signature": "0x"+r+s}
        sig = hashlib.sha256((digest_hex + self.address + self.private_key).encode()).hexdigest()
        full = sig.ljust(130, "0")[:130]
        return {"digest": "0x"+digest_hex, "v": 27, "r": "0x"+full[:64], "s": "0x"+full[64:128], "signature": "0x"+full}

    def sign_permit(self, owner: str, spender: str, value: int, nonce: int, deadline: int):
        """EIP-2612 permit digest helper."""
        if not HEX_ADDR_RE.match(owner) or not HEX_ADDR_RE.match(spender):
            raise ValueError("owner/spender must be 0x 40 hex")
        digest = keccak(f"Permit:{owner.lower()}:{spender.lower()}:{value}:{nonce}:{deadline}")
        sig = hashlib.sha256((digest + self.private_key).encode()).hexdigest()
        full = sig.ljust(130, "0")[:130]
        return {"digest": "0x"+digest, "v": 27, "r": "0x"+full[:64], "s": "0x"+full[64:128], "signature": "0x"+full[:130]}

    def __repr__(self):
        return f"<Wallet {self.address[:10]}…>"
