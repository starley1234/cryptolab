"""NanoTask Python SDK — minimalist A2A escrow client."""

from .client import NanoTaskClient  # noqa: F401
from .wallet import Wallet  # noqa: F401

__all__ = ["NanoTaskClient", "Wallet"]
__version__ = "1.0.0"
