# Pi Voice

A local, explicit speech-to-text extension for Pi on Linux. Dictate into the
existing prompt editor, mix speech with typing, and submit only when you choose.

## Speech-to-text stack

The selected stack for Pi Voice is the full Whisper large-v3 model
(not large-v3-turbo), run locally through whisper.cpp with Vulkan GPU
acceleration. Each completed recording runs one local batch transcription; there
is no streaming, voice-activity detection, silence-triggered stopping, configured
recording-duration cap, or automatic prompt submission.

## Requirements

- Pi 1.4.0-compatible terminal extension APIs and Node.js 22.19 or newer.
- Python 3.10 or newer (standard library only), PipeWire, `pw-record`, `wpctl`,
  and GNU `stdbuf` on `PATH`.
- An existing whisper.cpp Vulkan build and the full multilingual large-v3 GGML
  model. The extension does not download or install either artifact, fall back to
  another model, or accept CPU-only transcription.
- A terminal path that delivers key releases for hold-to-record. The explored
  target was WezTerm with Kitty input enabled → Herdr 0.9.5 → Pi. Explicit commands
  remain available when release delivery is unavailable.

## Load without installing

From this repository:

```sh
pi --extension .
```

From another working directory, pass the absolute path to the repository directory
or its public `index.ts` entry. Loading the extension does not open the microphone.
No Pi, terminal, or audio settings are changed. No package installation or build
step is needed. The previous `src/extension.ts` entry still works for development.

## Install globally for your user

From this repository, run:

```sh
pi install "$(pwd)"
```

This registers the local package in your user-level Pi settings, making it
available across projects. Restart Pi or run `/reload` to load it; `pi list` shows
the registered source. Local packages reference this checkout rather than copying
it, so keep the directory in place.

The package is named `pi-voice` and declares root `index.ts` as its sole extension
entry. Pi's compact extension label is `pi-voice` for a checkout/directory named
`pi-voice` (and for npm source `npm:pi-voice`), instead of an implementation-path
label such as `pi-voice:src/extension.ts`. Pi may still show source paths or scope
qualifiers in detailed views. Do not also load `src/extension.ts` explicitly when
the package is installed, or the extension may be loaded twice.

### Package layout

```text
pi-voice/
├── index.ts                 # Public extension entry
├── package.json             # Pi manifest and package name
├── src/                     # TypeScript implementation
└── worker/voice_worker.py   # Supervised local audio worker
```

The package includes both implementation and worker files. Resolving the worker
relative to its module keeps it independent of the active project's directory.

## Dictate

1. Return to the idle main prompt editor, with dialogs closed.
2. Hold **Ctrl+Q**. Wait for `recording`, then speak. The displayed stream-active
   state is not a sample-exact guarantee that the first phoneme is captured.
3. Release **Q** to finalize and transcribe. Releasing Q before Ctrl is the
   physically validated gesture. Repeated key presses do not start extra recorders.
4. The result is pasted at the cursor's **current position at delivery**, preserving
   text on either side and edits made during transcription. Each part is a native
   paste/undo unit. You can dictate successive parts after the previous one finishes.
5. Review spacing and punctuation, then send manually. Pi's native large-paste
   markers and whitespace normalization remain unchanged; Pi Voice adds no spaces.

Commands:

| Command | Action |
| --- | --- |
| `/voice start` | Start explicitly, without needing hold/release support. |
| `/voice stop` | Finish and transcribe; also the fallback for a lost key release. |
| `/voice cancel` | Discard the current part or pending result and clean up. |
| `/voice accept` | Paste a pending result explicitly into the current idle editor. |
| `/voice` or `/voice status` | Show status/help. |

Escape and Ctrl+C retain Pi's normal behavior; use `/voice cancel` to cancel voice
explicitly. Only one operation is allowed at a time; requests are not queued.

### System default microphone

Every new recording resolves the **current system default audio input**, then
requests that source by name. A USB microphone is used when it becomes the system
default; the built-in microphone is not hardcoded. Choose the default through
your normal system controls before starting a recording. Missing, ineligible, or
reported failing inputs cause an error rather than silently selecting another.
The active input description is shown while recording.

Changes to the default or removal of a device during an active recording are not
promised to switch transparently or remain pinned: PipeWire/session-manager
behavior can vary. Stop/cancel and start a fresh recording to resolve the new
default. The extension never changes defaults, gain, or mute settings.

### Editor and lifecycle safeguards

Submitting/clearing/replacing the draft, navigating history, starting agent work,
or changing session/branch cancels pending dictation without blocking your action.
Dialogs, external-editor activity, editor replacement, or an unobserved draft
change prevent blind automatic insertion: a completed same-session result can
remain in memory for `/voice accept` or `/voice cancel`. Closing a dialog alone
does not paste it. Session teardown/reload discards pending text and awaits cleanup.

These guards use Pi's public input/lifecycle APIs and live editor/focus checks;
they cannot detect every possible third-party extension's transient draft or focus
mutation. Unsupported editor/focus implementations fail closed rather than
replacing the user's editor. Physical integrated UI behavior still needs validation
in normal use; synthetic coverage is not proof of all terminal/device races.

## Local configuration

Defaults reuse the explored local installation:

| Environment variable | Default |
| --- | --- |
| `PI_VOICE_PYTHON` | `/usr/bin/python3` |
| `PI_VOICE_WHISPER_CLI` | `~/.local/bin/whisper-cli` |
| `PI_VOICE_MODEL` | `~/.local/share/whisper.cpp/models/ggml-large-v3.bin` |

Overrides must be absolute local paths (`~/` is accepted), read when recording
starts. They do not change microphone policy. Transcription uses automatic spoken
language detection, eight CPU threads, Vulkan device 0, and no translation.
Model-header checks require full large-v3 architecture, and runtime diagnostics
must confirm Vulkan0 and 32 encoder/decoder layers before text is accepted.
Header checks do not cryptographically authenticate model weights or executables.

## Privacy and process cleanup

A private Python supervisor owns capture/inference. Audio is kept in a fresh 0700
runtime/temp directory with a 0600 WAV. After explicit stop, the recorder is reaped
and the WAV's chunks/format/lengths are validated before transcription. An
intentional `pw-record` SIGINT exit of 1 is not automatically treated as failure;
unexpected exits, fatal diagnostics, forced termination, or invalid WAVs fail.

Stop/cancel cleanup escalates owned children from SIGINT to SIGTERM after two
seconds and SIGKILL after three; escalation discards audio. These deadlines do not
limit active recording or inference. Owner-pipe EOF cancels work if Pi disappears.
Audio is deleted after all owned writers/readers exit, before text is delivered.
No WAV, transcript, or raw ASR log is intentionally saved in the repository or
session by this extension. Pasting makes the text part of the normal editor; once
you submit it, normal Pi session/provider handling applies. Terminal/OS storage
and deletion are not secure physical erasure guarantees.

If cleanup cannot be confirmed, further capture is blocked for that runtime.
Check the microphone and owned processes/temp directories before restarting Pi;
restarting is not a cleanup action. A supervisor crash/SIGKILL, uninterruptible
OS waits, device routing changes, and sample-exact audio boundaries are not
covered by the orderly-cleanup guarantee. Transcript capture has an 8-MiB resource
bound; RIFF/disk/memory limits also apply despite having no configured time limit.

## Development checks

```sh
npm test
```

Tests use real installed Pi editor methods with synthetic text, fake subprocesses,
and an actual Node/Python control bridge with fake services. They never query a
live audio service, open the microphone, play audio, or run Whisper. No dependency
installation is required if Pi is already installed. If it cannot be found, set
`PI_VOICE_TEST_MODULE_ROOT` to its `node_modules` directory. Python worker tests
can run separately with `npm run test:worker`.

Historical feasibility records remain under `explorations/`; their one-shot
recording grants are spent and their launchers must not be reused as production
entry points.
