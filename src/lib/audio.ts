// Microphone capture for voice input. Records mono PCM via Web Audio, then
// downsamples to 16 kHz and encodes a 16-bit WAV — MiMo ASR only accepts
// WAV/MP3, and MediaRecorder's native container differs per webview (webm on
// Chromium, mp4/AAC on WKWebView), so we build the WAV ourselves.

export const ASR_SAMPLE_RATE = 16000;

/** Linear-interpolation resample to the ASR rate. No-op when rates match. */
export function downsample(samples: Float32Array, fromRate: number, toRate = ASR_SAMPLE_RATE): Float32Array {
	if (fromRate === toRate) return samples;
	const ratio = fromRate / toRate;
	const out = new Float32Array(Math.floor(samples.length / ratio));
	for (let i = 0; i < out.length; i++) {
		const pos = i * ratio;
		const lo = Math.floor(pos);
		const hi = Math.min(lo + 1, samples.length - 1);
		out[i] = samples[lo] + (samples[hi] - samples[lo]) * (pos - lo);
	}
	return out;
}

/** Mono 16-bit PCM WAV (44-byte RIFF header + samples). */
export function encodeWav(samples: Float32Array, rate = ASR_SAMPLE_RATE): Uint8Array {
	const buf = new ArrayBuffer(44 + samples.length * 2);
	const v = new DataView(buf);
	const str = (off: number, s: string) => {
		for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
	};
	str(0, 'RIFF');
	v.setUint32(4, 36 + samples.length * 2, true);
	str(8, 'WAVE');
	str(12, 'fmt ');
	v.setUint32(16, 16, true); // fmt chunk size
	v.setUint16(20, 1, true); // PCM
	v.setUint16(22, 1, true); // mono
	v.setUint32(24, rate, true);
	v.setUint32(28, rate * 2, true); // byte rate
	v.setUint16(32, 2, true); // block align
	v.setUint16(34, 16, true); // bits per sample
	str(36, 'data');
	v.setUint32(40, samples.length * 2, true);
	for (let i = 0; i < samples.length; i++) {
		const s = Math.max(-1, Math.min(1, samples[i]));
		v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
	}
	return new Uint8Array(buf);
}

/**
 * Peak-normalize quiet recordings toward `target`. WKWebView often captures at
 * a much lower level than Chromium; ASR models hallucinate filler ("嗯嗯…") on
 * near-silent audio, so boost it — but cap the gain so a truly silent take
 * doesn't get its noise floor amplified into garbage.
 */
export function normalize(samples: Float32Array, peak: number, target = 0.95, maxGain = 10): Float32Array {
	if (peak <= 0 || peak >= target) return samples;
	const gain = Math.min(target / peak, maxGain);
	if (gain <= 1) return samples;
	const out = new Float32Array(samples.length);
	for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain;
	return out;
}

/** btoa over the whole buffer at once blows the arg limit; chunk it. */
export function toBase64(bytes: Uint8Array): string {
	let bin = '';
	for (let i = 0; i < bytes.length; i += 0x8000) {
		bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(bin);
}

/**
 * One-shot microphone recorder: start() → speak → stop() returns base64 WAV.
 * Capture uses a zero-gain ScriptProcessor tap (destination connection is
 * required for processing to run; the gain node keeps the mic out of the
 * speakers).
 */
export class VoiceRecorder {
	private ctx: AudioContext | null = null;
	private stream: MediaStream | null = null;
	private chunks: Float32Array[] = [];
	private rate = 48000;
	/** Input device label, for diagnostics. */
	label = '';

	async start(): Promise<void> {
		// Ask for AGC/noise suppression explicitly — WKWebView doesn't reliably
		// enable them by default, and a too-quiet capture transcribes as filler.
		this.stream = await navigator.mediaDevices.getUserMedia({
			audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
		});
		this.label = this.stream.getAudioTracks()[0]?.label ?? '';
		this.ctx = new AudioContext();
		// A fresh AudioContext can start suspended in WKWebView; without resume()
		// the ScriptProcessor never fires and we'd record nothing.
		await this.ctx.resume().catch(() => {});
		this.rate = this.ctx.sampleRate;
		const source = this.ctx.createMediaStreamSource(this.stream);
		const tap = this.ctx.createScriptProcessor(4096, 1, 1);
		tap.onaudioprocess = (e) => this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
		const mute = this.ctx.createGain();
		mute.gain.value = 0;
		source.connect(tap);
		tap.connect(mute);
		mute.connect(this.ctx.destination);
	}

	/**
	 * Stops capture, releases the mic, and returns the encoded audio plus the
	 * pre-normalization peak amplitude (0–1) — a peak near 0 means the OS handed
	 * us silence (mic permission/device problem) and the clip isn't worth sending.
	 */
	stop(): { base64: string; seconds: number; peak: number } {
		this.stream?.getTracks().forEach((t) => t.stop());
		this.ctx?.close().catch(() => {});
		const total = this.chunks.reduce((n, c) => n + c.length, 0);
		const pcm = new Float32Array(total);
		let off = 0;
		for (const c of this.chunks) {
			pcm.set(c, off);
			off += c.length;
		}
		this.chunks = [];
		this.ctx = null;
		this.stream = null;
		let peak = 0;
		for (let i = 0; i < pcm.length; i++) {
			const a = Math.abs(pcm[i]);
			if (a > peak) peak = a;
		}
		return {
			base64: toBase64(encodeWav(normalize(downsample(pcm, this.rate), peak))),
			seconds: total / this.rate,
			peak
		};
	}
}
