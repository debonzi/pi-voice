import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export type VoiceConfig = {
  python: string;
  whisperCli: string;
  model: string;
  threads: 8;
  language: "auto";
};

/** Environment overrides are read only when the user explicitly starts dictation. */
export function readConfig(env = process.env, home = homedir()): VoiceConfig {
  const path = (key: string, fallback: string) => {
    const value = env[key] || fallback;
    const expanded = value.startsWith("~/") ? join(home, value.slice(2)) : value;
    if (!isAbsolute(expanded) || /[\x00-\x1f\x7f]/u.test(expanded)) {
      throw new Error(`${key} must be an absolute local path.`);
    }
    return expanded;
  };
  return {
    python: path("PI_VOICE_PYTHON", "/usr/bin/python3"),
    whisperCli: path("PI_VOICE_WHISPER_CLI", join(home, ".local/bin/whisper-cli")),
    model: path("PI_VOICE_MODEL", join(home, ".local/share/whisper.cpp/models/ggml-large-v3.bin")),
    threads: 8,
    language: "auto",
  };
}

export function admitText(value: string): string {
  // ASR is data, never terminal commands or bracketed-paste delimiters.
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/u.test(value)) {
    throw new Error("The transcription contains unsupported control characters.");
  }
  return value.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").trim();
}
