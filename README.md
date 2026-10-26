# Pi Voice

Local voice dictation for Pi on Linux. Speak into your prompt, mix dictation with
typing, and send only when you're ready.

- Transcribe speech locally with Whisper large-v3 and Vulkan GPU acceleration.
- Hold **Ctrl+Q** to record, or use explicit start/stop commands.
- Insert text at your cursor without replacing the rest of your draft.
- Use your system's default microphone and automatic language detection.
- Review and edit every transcription before submitting it.

## Requirements

- Linux with Pi 1.4.0-compatible terminal APIs and Node.js 22.19 or newer.
- Python 3.10 or newer, PipeWire, and `pw-record`, `wpctl`, and GNU `stdbuf`
  available on `PATH`.
- A working whisper.cpp build with Vulkan GPU support and the full multilingual
  **Whisper large-v3** GGML model (`ggml-large-v3.bin`). CPU-only transcription and
  large-v3-turbo are not supported.
- For hold-to-record, a terminal setup that forwards key-release events. Otherwise,
  use `/voice start` and `/voice stop`.

Pi Voice does not install these dependencies or download the model for you.

## Installation

With this repository checked out locally, run from its directory:

```sh
pi install "$(pwd)"
```

Restart Pi or run `/reload`. The extension will be available across your projects.
Keep the checkout in place: Pi loads the package from that directory.

To try it without installing, run from the repository directory:

```sh
pi --extension .
```

From another directory, replace `.` with the absolute path to the checkout. No
package installation or build step is needed. Loading Pi Voice does not activate
the microphone or change your Pi, terminal, or audio settings.

Use either installation or temporary loading, not both in the same session, to
avoid loading the extension twice.

## Configuration

Pi Voice uses the following paths by default. If your installation differs, set
these environment variables before launching Pi:

| Environment variable | Default |
| --- | --- |
| `PI_VOICE_PYTHON` | `/usr/bin/python3` |
| `PI_VOICE_WHISPER_CLI` | `~/.local/bin/whisper-cli` |
| `PI_VOICE_MODEL` | `~/.local/share/whisper.cpp/models/ggml-large-v3.bin` |

For example:

```sh
export PI_VOICE_WHISPER_CLI="/absolute/path/to/whisper-cli"
export PI_VOICE_MODEL="/absolute/path/to/ggml-large-v3.bin"
pi
```

Paths must be absolute; `~/` is also accepted. Transcription detects the spoken
language automatically and does not translate it.

Choose your default microphone through your system's audio settings before
recording. Pi Voice checks the current default at the start of each recording and
shows the selected input while recording. It does not change microphone defaults,
volume, or mute settings. If you switch or unplug a microphone, stop or cancel and
start a new recording.

## Usage

1. Return to Pi's main prompt with the agent idle and dialogs closed.
2. Hold **Ctrl+Q** and wait for the `recording` indicator before speaking.
3. Release **Q** before releasing Ctrl to finish recording and start transcription.
4. Wait for the text to appear at your cursor. You can keep typing while it
   transcribes; existing text is preserved.
5. Review the result, adjust spacing or punctuation, and submit manually.

You can dictate another part after the previous one finishes. Pi Voice does not
submit prompts, stop on silence, or transcribe while you are still recording.
Recording continues until you explicitly stop or cancel it.

### Commands

| Command | Action |
| --- | --- |
| `/voice start` | Start recording without holding a key. |
| `/voice stop` | Finish recording and transcribe. |
| `/voice cancel` | Discard the current recording or pending transcription. |
| `/voice accept` | Insert a pending transcription into the current idle editor. |
| `/voice` or `/voice status` | Show status and guidance. |

Use `/voice cancel` to cancel dictation; Escape and Ctrl+C keep their normal Pi
behavior.

Submitting or replacing your draft, starting agent work, or switching sessions or
branches discards pending dictation. If a dialog or editor change prevents safe
insertion, Pi Voice may hold the result for review. Return to the idle prompt and
use `/voice accept` to insert it, or `/voice cancel` to discard it. Reloading or
closing Pi discards pending text.

## Privacy

Recording starts only when you request it. Audio is transcribed locally, and
temporary audio files are removed after processing or cancellation during normal
operation. Pi Voice does not intentionally save audio or separate transcript files.

Once inserted, the text is part of your normal Pi draft. Submitting it uses Pi's
usual session storage and provider handling. Local file deletion is not a guarantee
of secure erasure.

## Troubleshooting

- **Releasing the shortcut does not stop recording:** use `/voice stop`. Your
  terminal setup may not forward key-release events; use start/stop commands
  instead.
- **Recording will not start:** return to the idle main prompt, close dialogs,
  and check that your default microphone is available and unmuted.
- **Transcription fails:** check your executable and model paths, Vulkan GPU
  support, and that the model is full large-v3 rather than large-v3-turbo.
- **A transcription is pending:** use `/voice accept` at the idle prompt, or
  `/voice cancel` to discard it.
- **Recording is blocked after a cleanup error:** check that the microphone is
  no longer recording and that related audio/transcription processes have stopped
  before restarting Pi. Restarting alone does not ensure cleanup.
