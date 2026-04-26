import { config } from "../../config.js";

/**
 * D-ID: create a talking-avatar video from TTS audio URL or buffer upload.
 * Many accounts require a public audio URL; for local dev we return null and
 * the client plays TTS with a static or animated placeholder.
 */
export async function createDidTalkFromAudioBase64(
  _audioBase64: string
): Promise<{ videoUrl: string | null; error?: string }> {
  if (!config.didApiKey) {
    return { videoUrl: null };
  }
  // D-ID v2: POST /talks with type script/audio_url — requires hosted audio in production.
  // Placeholder: wire when PUBLIC_URL or S3 hosts short mp3s.
  return { videoUrl: null, error: "D-ID requires a public audio URL; use TTS-only mode for now." };
}

export function didImageUrlForUi(): string | null {
  return config.didAvatarSourceUrl || null;
}
