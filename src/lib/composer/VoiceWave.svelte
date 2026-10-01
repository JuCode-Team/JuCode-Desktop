<script lang="ts">
	// Scrolling level bars for the live microphone signal. Levels are scaled
	// against a slowly decaying recent peak, so quiet webview captures still
	// fill the strip.
	let { analyser }: { analyser: AnalyserNode } = $props();
	let canvas: HTMLCanvasElement;

	const BAR = 2;
	const GAP = 2;
	const STEP_MS = 50;

	$effect(() => {
		const g = canvas.getContext('2d');
		if (!g) return;
		const dpr = devicePixelRatio || 1;
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		canvas.width = w * dpr;
		canvas.height = h * dpr;
		g.scale(dpr, dpr);
		const color = getComputedStyle(canvas).color;
		const samples = new Float32Array(analyser.fftSize);
		const levels = new Array(Math.floor((w + GAP) / (BAR + GAP))).fill(0);
		let peak = 0.004;
		let last = 0;
		let raf = requestAnimationFrame(function frame(now) {
			raf = requestAnimationFrame(frame);
			if (now - last < STEP_MS) return;
			last = now;
			analyser.getFloatTimeDomainData(samples);
			let sum = 0;
			for (const s of samples) sum += s * s;
			const rms = Math.sqrt(sum / samples.length);
			peak = Math.max(peak * 0.995, rms, 0.004);
			levels.shift();
			levels.push(rms / peak);
			g.clearRect(0, 0, w, h);
			g.fillStyle = color;
			levels.forEach((level, i) => {
				const bh = Math.max(2, level * h);
				g.beginPath();
				g.roundRect(i * (BAR + GAP), (h - bh) / 2, BAR, bh, BAR / 2);
				g.fill();
			});
		});
		return () => cancelAnimationFrame(raf);
	});
</script>

<canvas bind:this={canvas} class="wave" aria-hidden="true"></canvas>

<style>
	.wave {
		width: 88px;
		height: 22px;
		flex-shrink: 0;
		color: var(--dim);
	}
</style>
