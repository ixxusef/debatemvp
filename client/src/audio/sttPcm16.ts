const TARGET = 16_000;

/**
 * Resample float32 mono audio to 16kHz for Deepgram and convert to 16-bit PCM base64.
 */
export function to16kPcmBase64(
  input: Float32Array,
  inputRate: number
): { data: string; sampleRate: number } {
  if (inputRate === TARGET) {
    return { data: float32ToPcm16Base64(input), sampleRate: TARGET };
  }
  const outLen = Math.floor((input.length * TARGET) / inputRate);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const s = (i * inputRate) / TARGET;
    const a = Math.floor(s);
    const f = s - a;
    const a2 = Math.min(a + 1, input.length - 1);
    out[i] = input[a]! * (1 - f) + input[a2]! * f;
  }
  return { data: float32ToPcm16Base64(out), sampleRate: TARGET };
}

function float32ToPcm16Base64(f: Float32Array): string {
  const b = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const s = Math.max(-1, Math.min(1, f[i] ?? 0));
    b[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(b.buffer);
  let bin = "";
  const block = 0x8000;
  for (let i = 0; i < bytes.length; i += block) {
    const slice = bytes.subarray(i, i + block);
    bin += String.fromCharCode.apply(null, Array.from(slice) as number[]);
  }
  return btoa(bin);
}

/**
 * ScriptProcessor: capture mic and emit 16kHz PCM (base64) for Deepgram.
 * Uses zero-gain output to avoid feedback.
 */
export function createMicPcm16Stream(
  stream: MediaStream,
  onChunk: (chunk: { data: string; sampleRate: number }) => void
): { stop: () => void; context: AudioContext; inputRate: number } {
  const context = new AudioContext();
  const inputRate = context.sampleRate;
  const source = context.createMediaStreamSource(stream);
  const bufferSize = 4096;
  const script = context.createScriptProcessor(bufferSize, 1, 1);
  const mute = context.createGain();
  mute.gain.value = 0;
  script.onaudioprocess = (e) => {
    const pin = e.inputBuffer.getChannelData(0);
    const copy = new Float32Array(pin.length);
    copy.set(pin);
    const b64 = to16kPcmBase64(copy, inputRate);
    onChunk(b64);
  };
  source.connect(script);
  script.connect(mute);
  mute.connect(context.destination);
  return {
    context,
    inputRate,
    stop: () => {
      script.disconnect();
      source.disconnect();
      mute.disconnect();
    },
  };
}
