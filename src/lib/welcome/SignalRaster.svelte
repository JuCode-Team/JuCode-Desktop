<script lang="ts">
	// The website's Signal Raster (JuCode-frontend src/components/SignalRaster.tsx):
	// two sine carriers drawn as a square dot field, bent toward the pointer.
	// Same shader and colors; the site's scroll boost is dropped (nothing
	// scrolls here) and the theme comes from data-theme instead of a class.

	const VERTEX_SHADER = `
attribute vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

	const FRAGMENT_SHADER = `
precision highp float;

uniform vec2 u_resolution;
uniform vec2 u_pointer;
uniform float u_dpr;
uniform float u_hover;
uniform float u_time;
uniform float u_light;

void main() {
  vec2 cssResolution = u_resolution / u_dpr;
  vec2 point = gl_FragCoord.xy / u_dpr;
  vec2 uv = point / cssResolution;

  float stepSize = cssResolution.x < 560.0 ? 10.0 : 11.0;
  vec2 cell = abs(fract(point / stepSize) - 0.5) * stepSize;

  float carrier = 0.5 + sin(uv.x * 8.4 + u_time * 0.72) * 0.17;
  float secondary = 0.52 + sin(uv.x * 5.2 - u_time * 0.5328) * 0.12;
  float distanceToWave = min(abs(uv.y - carrier), abs(uv.y - secondary));

  float pointerDistance = distance(uv, u_pointer);
  float pointerInfluence = (1.0 - smoothstep(0.0, 0.2, pointerDistance)) * u_hover;
  distanceToWave -= pointerInfluence * 0.07;

  float strength = clamp(1.0 - distanceToWave / 0.17, 0.0, 1.0);

  float halfSize = 0.65 + strength * 0.75 + pointerInfluence * 0.55;
  float squareDistance = max(cell.x, cell.y);
  float dotMask = 1.0 - smoothstep(halfSize, halfSize + 0.15, squareDistance);
  float alpha = min(1.0, 0.16 + pow(strength, 0.72) * 0.84 + pointerInfluence * 0.12);
  alpha *= dotMask * step(0.06, strength);

  vec3 purple = mix(vec3(0.592, 0.404, 0.933), vec3(0.396, 0.251, 0.722), u_light);
  vec3 blue = mix(vec3(0.537, 0.808, 1.0), vec3(0.224, 0.486, 0.635), u_light);
  vec3 color = mix(purple, blue, step(0.52, uv.x));
  // premultipliedAlpha: true — straight alpha smears on Windows/ANGLE.
  gl_FragColor = vec4(color * alpha, alpha);
}
`;

	// Once a canvas has handed out a WebGL context it never gives a 2D one, so
	// the fallback remounts the canvas.
	let mode = $state<'webgl' | 'canvas2d'>('webgl');
	let canvas = $state<HTMLCanvasElement>();
	let ready = $state(false);

	const isLight = () => document.documentElement.getAttribute('data-theme') === 'light';

	function compile(gl: WebGLRenderingContext, type: number, source: string) {
		const shader = gl.createShader(type);
		if (!shader) return null;
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
			console.warn('SignalRaster shader compile failed:', gl.getShaderInfoLog(shader));
			gl.deleteShader(shader);
			return null;
		}
		return shader;
	}

	// The static frame of the same field, for machines without WebGL.
	function canvas2d(el: HTMLCanvasElement) {
		const ctx = el.getContext('2d');
		if (!ctx) return;
		const draw = () => {
			const rect = el.getBoundingClientRect();
			const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
			const width = Math.max(1, rect.width);
			const height = Math.max(1, rect.height);
			el.width = Math.round(width * ratio);
			el.height = Math.round(height * ratio);
			ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
			ctx.clearRect(0, 0, width, height);
			const step = width < 560 ? 10 : 11;
			const light = isLight();
			for (let y = 0; y <= height; y += step) {
				for (let x = 0; x <= width; x += step) {
					const nx = x / width;
					const ny = y / height;
					const carrier = 0.5 + Math.sin(nx * 8.4) * 0.17;
					const secondary = 0.52 + Math.sin(nx * 5.2) * 0.12;
					const strength = Math.max(0, 1 - Math.min(Math.abs(ny - carrier), Math.abs(ny - secondary)) / 0.17);
					if (strength <= 0.06) continue;
					const alpha = 0.08 + strength * 0.78;
					ctx.fillStyle =
						nx < 0.52
							? light
								? `rgba(101, 64, 184, ${alpha})`
								: `rgba(151, 103, 238, ${alpha})`
							: light
								? `rgba(57, 124, 162, ${alpha * 0.9})`
								: `rgba(137, 206, 255, ${alpha * 0.9})`;
					ctx.fillRect(x, y, 1 + strength * 1.35, 1 + strength * 1.35);
				}
			}
			ready = true;
		};
		draw();
		const themeObserver = new MutationObserver(draw);
		themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
		window.addEventListener('resize', draw);
		return () => {
			themeObserver.disconnect();
			window.removeEventListener('resize', draw);
		};
	}

	function webgl(el: HTMLCanvasElement) {
		const fallBack = () => {
			mode = 'canvas2d';
		};
		const gl = el.getContext('webgl', {
			alpha: true,
			antialias: false,
			depth: false,
			powerPreference: 'low-power',
			premultipliedAlpha: true
		});
		if (!gl) return fallBack();
		const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
		const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
		if (!vertex || !fragment) return fallBack();
		const program = gl.createProgram();
		if (!program) return fallBack();
		gl.attachShader(program, vertex);
		gl.attachShader(program, fragment);
		gl.linkProgram(program);
		gl.deleteShader(vertex);
		gl.deleteShader(fragment);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			console.warn('SignalRaster program link failed:', gl.getProgramInfoLog(program));
			gl.deleteProgram(program);
			return fallBack();
		}
		const buffer = gl.createBuffer();
		if (!buffer) return fallBack();
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
		gl.useProgram(program);
		const position = gl.getAttribLocation(program, 'a_position');
		gl.enableVertexAttribArray(position);
		gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

		const u = (name: string) => gl.getUniformLocation(program, name);
		const uResolution = u('u_resolution');
		const uPointer = u('u_pointer');
		const uDpr = u('u_dpr');
		const uHover = u('u_hover');
		const uTime = u('u_time');
		const uLight = u('u_light');

		let ratio = 1;
		let rect = el.getBoundingClientRect();
		let targetX = 0.72;
		let targetY = 0.5;
		let currentX = targetX;
		let currentY = targetY;
		let targetHover = 0;
		let currentHover = 0;
		let frame = 0;
		let running = false;
		let time = 0;
		let last = 0;
		let light = isLight() ? 1 : 0;
		const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

		const resize = () => {
			rect = el.getBoundingClientRect();
			// A dot field gains nothing from full Retina resolution; the cap keeps
			// fill-rate stable on 3x displays.
			ratio = Math.min(window.devicePixelRatio || 1, 1.5);
			const width = Math.max(1, Math.round(rect.width * ratio));
			const height = Math.max(1, Math.round(rect.height * ratio));
			if (el.width !== width || el.height !== height) {
				el.width = width;
				el.height = height;
				gl.viewport(0, 0, width, height);
			}
		};

		const draw = (t: number) => {
			currentX += (targetX - currentX) * 0.16;
			currentY += (targetY - currentY) * 0.16;
			currentHover += (targetHover - currentHover) * 0.12;
			gl.clearColor(0, 0, 0, 0);
			gl.clear(gl.COLOR_BUFFER_BIT);
			gl.uniform2f(uResolution, el.width, el.height);
			gl.uniform2f(uPointer, currentX, currentY);
			gl.uniform1f(uDpr, ratio);
			gl.uniform1f(uHover, currentHover);
			gl.uniform1f(uTime, reduceMotion ? 0 : t);
			gl.uniform1f(uLight, light);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
			ready = true;
		};

		const render = (now: number) => {
			const delta = last === 0 ? 0 : Math.min(0.05, (now - last) / 1000);
			last = now;
			time += delta;
			draw(time);
			if (running) frame = requestAnimationFrame(render);
		};
		const start = () => {
			if (running || reduceMotion || document.hidden) return;
			running = true;
			last = 0;
			frame = requestAnimationFrame(render);
		};
		const stop = () => {
			running = false;
			cancelAnimationFrame(frame);
		};

		const onPointerMove = (e: PointerEvent) => {
			const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
			targetHover = inside ? 1 : 0;
			if (inside) {
				targetX = (e.clientX - rect.left) / rect.width;
				targetY = 1 - (e.clientY - rect.top) / rect.height;
			}
			if (reduceMotion) {
				currentX = targetX;
				currentY = targetY;
				currentHover = targetHover;
				draw(0);
			}
		};
		const onResize = () => {
			resize();
			draw(time);
		};
		const onVisibility = () => (document.hidden ? stop() : start());
		const onContextLost = (e: Event) => {
			// GPU driver resets would leave the canvas blank; drop to the 2D frame.
			e.preventDefault();
			stop();
			fallBack();
		};
		const themeObserver = new MutationObserver(() => {
			light = isLight() ? 1 : 0;
			if (reduceMotion) draw(0);
		});
		const sizeObserver = new ResizeObserver(onResize);

		resize();
		draw(0);
		themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
		sizeObserver.observe(el);
		window.addEventListener('pointermove', onPointerMove, { passive: true });
		document.addEventListener('visibilitychange', onVisibility);
		el.addEventListener('webglcontextlost', onContextLost);
		start();

		return () => {
			stop();
			themeObserver.disconnect();
			sizeObserver.disconnect();
			window.removeEventListener('pointermove', onPointerMove);
			document.removeEventListener('visibilitychange', onVisibility);
			el.removeEventListener('webglcontextlost', onContextLost);
			gl.deleteBuffer(buffer);
			gl.deleteProgram(program);
		};
	}

	$effect(() => {
		if (!canvas) return;
		return mode === 'webgl' ? webgl(canvas) : canvas2d(canvas);
	});
</script>

{#key mode}
	<canvas bind:this={canvas} class:ready aria-hidden="true"></canvas>
{/key}

<style>
	canvas {
		display: block;
		width: 100%;
		height: 100%;
		opacity: 0;
		transition: opacity 0.5s ease;
	}
	canvas.ready {
		opacity: var(--raster-opacity, 0.56);
	}
</style>
