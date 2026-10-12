import sys
from pathlib import Path


repo_dir = Path(__file__).resolve().parent
parent_dir = repo_dir.parent
if str(parent_dir) not in sys.path:
    sys.path.insert(0, str(parent_dir))

from pathfinder_ucd_modern.web.app import app  # noqa: E402
