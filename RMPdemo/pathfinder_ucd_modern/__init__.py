from pathlib import Path


_PACKAGE_DIR = Path(__file__).resolve().parent
_PROJECT_DIR = _PACKAGE_DIR.parent

# Keep the published package name working even when the checkout directory has
# a different name, such as the local RMPdemo workspace.
__path__.append(str(_PROJECT_DIR))
