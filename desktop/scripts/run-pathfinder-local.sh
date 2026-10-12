#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RMP_ROOT="$(cd "$DESKTOP_DIR/../.." && pwd)"

LOCAL_GO="$RMP_ROOT/.toolchains/go/bin"
LOCAL_WAILS="$HOME/go/bin"
LOCAL_BIN="$DESKTOP_DIR/.local-bin"
export PATH="$LOCAL_GO:$LOCAL_WAILS:$LOCAL_BIN:$PATH"
export GOPROXY="${GOPROXY:-https://goproxy.cn,direct}"
export PATHFINDER_DATA_ROOT="${PATHFINDER_DATA_ROOT:-$RMP_ROOT/RMPdemo/data}"

cd "$DESKTOP_DIR"

if ! command -v pnpm >/dev/null 2>&1; then
  mkdir -p "$LOCAL_BIN"
  cat > "$LOCAL_BIN/pnpm" <<'PNPM'
#!/usr/bin/env bash
exec npx --yes pnpm@latest "$@"
PNPM
  chmod +x "$LOCAL_BIN/pnpm"
fi

if ! command -v wails >/dev/null 2>&1; then
  echo "wails CLI not found. Install it with:"
  echo "  GOPROXY=$GOPROXY $LOCAL_GO/go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0"
  exit 1
fi

if [[ "${1:-}" == "--wails-dev" ]]; then
  exec wails dev
fi

wails build -clean -nopackage
exec "$DESKTOP_DIR/build/bin/pathfinder-ucd"
