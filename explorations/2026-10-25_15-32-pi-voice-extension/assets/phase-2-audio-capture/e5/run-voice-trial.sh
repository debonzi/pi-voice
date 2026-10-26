#!/usr/bin/env bash
# E5 exploration only: explicitly loaded diagnostic in its own offline Pi.
# Creates only private runtime artifacts here. No microphone until Ctrl+Q.
set -euo pipefail
umask 077
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ ! -t 0 || ! -t 1 ]]; then
  printf 'Run this launcher in a separate interactive Herdr terminal pane. No microphone opened.\n' >&2
  exit 1
fi
if [[ -z "${HERDR_PANE_ID:-}" ]]; then
  printf 'Required Herdr pane context is absent. No microphone opened.\n' >&2
  exit 1
fi
if [[ -e "$here/authorization-used.json" ]]; then
  printf 'E5 attempt already reserved. Keep the evidence and request review; do not reset/retry.\n' >&2
  exit 1
fi
runtime="$here/runtime"
mkdir -p "$runtime/agent" "$runtime/cache" "$runtime/tmp"
# Full read-only hash verification, before Pi starts and before recording.
/usr/bin/python3 -B "$here/worker.py" --check > "$runtime/artifact-check.log"
export PI_CODING_AGENT_DIR="$runtime/agent"
export PI_CODING_AGENT_SESSION_DIR="$runtime/sessions"
export PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0
export JITI_FS_CACHE=false NODE_DISABLE_COMPILE_CACHE=1
export XDG_CACHE_HOME="$runtime/cache" TMPDIR="$runtime/tmp"
unset PI_SESSION_FILE PI_SESSION_ID PI_PROVIDER PI_MODEL PI_REASONING_LEVEL PI_TUI_WRITE_LOG
cd -- "$here"
printf 'E5: hold Ctrl+Q, speak freely, release Q first; no recording-duration limit.\n'
printf 'After batch transcription: close viewer, /voice-test pass or /voice-test fail.\n'
printf 'Escape or /voice-test cancel discards; /voice-test stop is the release fallback.\n'
exec pi --offline --no-extensions --no-mcp --no-tools --no-session \
  --no-approve --no-skills --no-prompt-templates --no-context-files --no-themes \
  --extension "$here/voice-trial.ts"
