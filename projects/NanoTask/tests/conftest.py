import sys
from pathlib import Path

# allow imports from contracts/lib and sdk if needed
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
