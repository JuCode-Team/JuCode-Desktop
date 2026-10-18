// The app's alert sounds, synthesized rather than shipped as files: a hard
// wooden block struck with a stick. The stick's contact is a Hertzian force
// pulse (sin^1.5, about 0.4 ms), which rings a hardwood block's modes
// (inharmonic, about 1 : 2.6 : 4.2, damped as wood is, Q 18-28) so it is a
// short, warm knock with a hint of pitch; a faint short room follows it.
// Falling two knocks say done; rising, the user is asked for something.

export type Chime = 'done' | 'attention';

/** One block mode: frequency ratio to the knock's pitch, level, Q. */
const MODES: [number, number, number][] = [
	[1, 1, 28],
	[2.57, 0.45, 22],
	[4.21, 0.2, 18]
];

/** Each sound's knocks: pitch (Hz), onset (s), level. */
const KNOCKS: Record<Chime, [number, number, number][]> = {
	done: [
		[1050, 0, 1],
		[790, 0.11, 0.8]
	],
	attention: [
		[790, 0, 0.85],
		[1050, 0.11, 1]
	]
};

const CONTACT = 0.0004;
/** Room: level of the tail against the knock, its decay (s), its lowpass (Hz). */
const ROOM: [number, number, number] = [0.1, 0.06, 5000];
/** Loudness: RMS over the sound, before a soft limit keeps the attack under full scale. */
const LOUDNESS = 0.07;
const LENGTH = 0.45;

/** Deterministic noise, so a sound is the same every time it plays. */
function noise(seed: number) {
	let s = seed >>> 0 || 1;
	return () => {
		s ^= s << 13;
		s ^= s >>> 17;
		s ^= s << 5;
		return ((s >>> 0) / 0xffffffff) * 2 - 1;
	};
}

/** Rings a damped two-pole resonator at `f` (Hz) driven by `input`, adding into `out`. */
function ring(out: Float32Array, input: Float32Array, rate: number, f: number, q: number, gain: number) {
	if (f >= rate / 2) return;
	const w = (2 * Math.PI * f) / rate;
	const r = Math.exp((-Math.PI * f) / (q * rate));
	const c = 2 * r * Math.cos(w);
	// Normalized at the peak, so `gain` is the mode's level.
	const g = gain * (1 - r) * 2 * Math.sin(w);
	let y1 = 0;
	let y2 = 0;
	for (let n = 0; n < out.length; n++) {
		const y = input[n] * g + c * y1 - r * r * y2;
		y2 = y1;
		y1 = y;
		out[n] += y;
	}
}

/** The mono samples of `kind` at `rate`. */
export function renderChime(kind: Chime, rate: number): Float32Array<ArrayBuffer> {
	const length = Math.ceil(LENGTH * rate);
	const rand = noise(0x9e3779b1);
	const dry = new Float32Array(length);
	for (const [pitch, at, level] of KNOCKS[kind]) {
		// The stick's contact force.
		const force = new Float32Array(length);
		const start = Math.round(at * rate);
		const contact = Math.max(3, Math.round(CONTACT * rate));
		for (let i = 0; i < contact && start + i < length; i++) force[start + i] = Math.pow(Math.sin((Math.PI * i) / contact), 1.5);
		// A hair of detune per mode, as no two blocks are tuned alike.
		for (const [ratio, gain, q] of MODES) ring(dry, force, rate, pitch * ratio * (1 + rand() * 0.003), q, gain * level);
	}
	// The room: the knock convolved with a short, decaying, lowpassed noise tail.
	const [wet, decay, cutoff] = ROOM;
	const ir = new Float32Array(Math.round(decay * 4 * rate));
	const k = Math.exp((-2 * Math.PI * cutoff) / rate);
	const pre = Math.round(0.003 * rate);
	let lp = 0;
	let irEnergy = 0;
	for (let i = 0; i < ir.length; i++) {
		lp = (1 - k) * rand() + k * lp;
		ir[i] = i < pre ? 0 : lp * Math.exp(-(i - pre) / (decay * rate));
		irEnergy += ir[i] * ir[i];
	}
	const scale = wet / Math.sqrt(irEnergy || 1);
	let dryPeak = 0;
	for (const v of dry) dryPeak = Math.max(dryPeak, Math.abs(v));
	const out = new Float32Array(length);
	for (let n = 0; n < length; n++) {
		const x = dry[n];
		out[n] += x;
		// Below -60 dB the knock adds nothing audible to the room.
		if (Math.abs(x) < dryPeak * 1e-3) continue;
		for (let i = pre; i < ir.length && n + i < length; i++) out[n + i] += ir[i] * x * scale;
	}
	let energy = 0;
	for (const v of out) energy += v * v;
	const gain = LOUDNESS / Math.sqrt(energy / length || 1);
	// A short fade at the very end so the tail never stops on a click.
	const fade = Math.round(0.03 * rate);
	for (let i = 0; i < length; i++) out[i] = Math.tanh(out[i] * gain) * Math.min(1, (length - i) / fade);
	return out;
}

let ctx: AudioContext | null = null;
const buffers = new Map<Chime, AudioBuffer>();

function context(): AudioContext | null {
	if (typeof AudioContext === 'undefined') return null;
	ctx ??= new AudioContext();
	return ctx;
}

/** The webview starts audio suspended until a user gesture; the first one
 *  unlocks it, so a sound for a turn that ends later can play. */
export function unlockChimes() {
	if (typeof window === 'undefined') return;
	const unlock = () => {
		void context()?.resume().catch(() => {});
		window.removeEventListener('pointerdown', unlock, true);
		window.removeEventListener('keydown', unlock, true);
	};
	window.addEventListener('pointerdown', unlock, true);
	window.addEventListener('keydown', unlock, true);
}

export function playChime(kind: Chime) {
	const audio = context();
	if (!audio) return;
	let buffer = buffers.get(kind);
	if (!buffer) {
		const samples = renderChime(kind, audio.sampleRate);
		buffer = audio.createBuffer(1, samples.length, audio.sampleRate);
		buffer.copyToChannel(samples, 0);
		buffers.set(kind, buffer);
	}
	const source = audio.createBufferSource();
	source.buffer = buffer;
	source.connect(audio.destination);
	void audio.resume().catch(() => {});
	source.start();
}
