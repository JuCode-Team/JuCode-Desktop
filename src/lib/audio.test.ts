import { describe, expect, it } from 'vitest';
import { ASR_SAMPLE_RATE, downsample, encodeWav, toBase64 } from './audio';

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
