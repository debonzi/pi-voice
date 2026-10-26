#!/usr/bin/env bash
# Keyboard-only experiment; creates runtime artifacts only beside this launcher.
set -euo pipefail
asset_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
runtime="$asset_dir/ctrl-q-runtime"
mkdir -p "$runtime/agent" "$runtime/cache" "$runtime/tmp"
export PI_CODING_AGENT_DIR="$runtime/agent"
export PI_CODING_AGENT_SESSION_DIR="$runtime/sessions"
export PI_OFFLINE=1
export PI_SKIP_VERSION_CHECK=1
export JITI_FS_CACHE=false
export XDG_CACHE_HOME="$runtime/cache"
export TMPDIR="$runtime/tmp"
export NODE_DISABLE_COMPILE_CACHE=1
cd -- "$asset_dir"
exec pi --offline --no-extensions --no-mcp --no-tools --no-session \
  --no-approve --no-skills --no-prompt-templates --no-context-files \
  --extension "$asset_dir/ctrl-q-probe.ts"
