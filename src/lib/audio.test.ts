import { describe, expect, it } from 'vitest';
import { ASR_PROVIDERS, ASR_SAMPLE_RATE, Segmenter, asrProvider, downsample, encodeWav, resolveAsrSettings, toBase64 } from './audio';

describe('ASR providers', () => {
	it('switches to each provider default', () => {
		for (const provider of ASR_PROVIDERS) {
			expect(resolveAsrSettings({ provider: provider.id })).toEqual({
				provider: provider.id,
				base_url: provider.baseUrl,
				model: provider.model
			});
		}
	});

	it('keeps custom endpoint and model for a known provider', () => {
		expect(resolveAsrSettings({ provider: 'openai', base_url: ' https://whisper.example/v1/ ', model: ' custom-whisper ' })).toEqual({
			provider: 'openai',
			base_url: 'https://whisper.example/v1/',
			model: 'custom-whisper'
		});
	});

	it('falls back to MiMo for missing or unknown settings', () => {
		const mimo = asrProvider('mimo');
		expect(resolveAsrSettings(null)).toEqual({ provider: 'mimo', base_url: mimo.baseUrl, model: mimo.model });
		expect(resolveAsrSettings({ provider: 'unknown' }).provider).toBe('mimo');
	});
});

describe('downsample', () => {
	it('returns input untouched when rates match', () => {
		const s = new Float32Array([0.1, 0.2, 0.3]);
		expect(downsample(s, ASR_SAMPLE_RATE)).toBe(s);
	});

	it('halves the sample count from 32k to 16k', () => {
		const s = new Float32Array(3200).fill(0.5);
		const out = downsample(s, 32000);
		expect(out.length).toBe(1600);
		expect(out[0]).toBeCloseTo(0.5);
		expect(out[out.length - 1]).toBeCloseTo(0.5);
	});

	it('interpolates between neighboring samples', () => {
		// 2:1 ratio over a ramp keeps the ramp (every other point).
		const s = new Float32Array([0, 0.25, 0.5, 0.75, 1, 1, 1, 1]);
		const out = downsample(s, 32000);
		expect(out[0]).toBeCloseTo(0);
		expect(out[1]).toBeCloseTo(0.5);
	});
});

describe('encodeWav', () => {
	it('writes a valid mono 16-bit RIFF header', () => {
		const wav = encodeWav(new Float32Array(100));
		const v = new DataView(wav.buffer);
		expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF');
		expect(String.fromCharCode(...wav.subarray(8, 12))).toBe('WAVE');
		expect(wav.length).toBe(44 + 200);
		expect(v.getUint32(4, true)).toBe(36 + 200); // RIFF size
		expect(v.getUint16(20, true)).toBe(1); // PCM
		expect(v.getUint16(22, true)).toBe(1); // mono
		expect(v.getUint32(24, true)).toBe(ASR_SAMPLE_RATE);
		expect(v.getUint32(40, true)).toBe(200); // data size
	});

	it('clamps and scales samples to int16', () => {
		const wav = encodeWav(new Float32Array([1, -1, 2, -2, 0]));
		const v = new DataView(wav.buffer);
		expect(v.getInt16(44, true)).toBe(0x7fff);
		expect(v.getInt16(46, true)).toBe(-0x8000);
		expect(v.getInt16(48, true)).toBe(0x7fff); // clamped
		expect(v.getInt16(50, true)).toBe(-0x8000); // clamped
		expect(v.getInt16(52, true)).toBe(0);
	});
});

describe('toBase64', () => {
	it('round-trips bytes through base64', () => {
		const bytes = new Uint8Array(70000).map((_, i) => i % 256);
		const decoded = Uint8Array.from(atob(toBase64(bytes)), (c) => c.charCodeAt(0));
		expect(decoded).toEqual(bytes);
	});
});

describe('Segmenter', () => {
	// 100 Hz blocks keep the arithmetic readable: one block = 10 ms.
	const RATE = 1000;
	const block = (level: number) => new Float32Array(10).fill(level);
	const feed = (seg: Segmenter, level: number, blocks: number) => {
		const out: Float32Array[] = [];
		for (let i = 0; i < blocks; i++) {
			const pcm = seg.push(block(level));
			if (pcm) out.push(pcm);
		}
		return out;
	};

	it('cuts an utterance after a long pause', () => {
		const seg = new Segmenter(RATE);
		expect(feed(seg, 0.1, 100)).toEqual([]); // 1 s speech
		const out = feed(seg, 0.001, 80); // 0.8 s pause
		expect(out).toHaveLength(1);
		expect(out[0].length).toBe(1800);
	});

	it('keeps only a short pre-roll of leading silence', () => {
		const seg = new Segmenter(RATE);
		feed(seg, 0, 200);
		feed(seg, 0.1, 50);
		expect(seg.flush()!.length).toBe(300 + 500);
	});

	it('drops segments with too little speech', () => {
		const seg = new Segmenter(RATE);
		feed(seg, 0.1, 5); // 50 ms click
		expect(feed(seg, 0.001, 100)).toEqual([]);
		expect(seg.flush()).toBeNull();
	});

	it('treats audio well below the segment peak as a pause', () => {
		const seg = new Segmenter(RATE);
		feed(seg, 0.2, 100);
		expect(feed(seg, 0.02, 80)).toHaveLength(1);
	});

	it('accepts a shorter pause once the segment runs long, and hard-cuts at the cap', () => {
		const seg = new Segmenter(RATE);
		feed(seg, 0.1, 1300);
		expect(feed(seg, 0.001, 30)).toHaveLength(1);
		expect(feed(seg, 0.1, 3000)).toHaveLength(1);
	});
});
