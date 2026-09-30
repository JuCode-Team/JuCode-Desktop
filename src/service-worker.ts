/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
// The phone PWA's offline shell. Install caches only the /remote page, the
// manifest and icons; the build is shared with the desktop app, so its files
// are cached as the phone first loads them (cache first, names are hashed)
// instead of all ~5 MB up front. After one online visit the home-screen app
// opens without a network (it then waits for the relay). Registered only by
// the /remote page outside Tauri (svelte.config.js turns automatic
// registration off).
import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `jucode-shell-${version}`;
const SHELL = '/remote';
const PRECACHE = [SHELL, ...files.filter((f) => /^\/(manifest\.webmanifest|icon-\d+\.png|apple-touch-icon\.png|favicon\.png)$/.test(f))];
const BUILD = new Set(build);

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== sw.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/relay/'))
		return;
	// Pages: network first, the cached shell offline (the app is an SPA).
	if (request.mode === 'navigate') {
		event.respondWith(fetch(request).catch(async () => (await caches.match(SHELL)) ?? Response.error()));
		return;
	}
	// Build files: cache first, stored on first use (file names are hashed).
	if (BUILD.has(url.pathname) || PRECACHE.includes(url.pathname)) {
		event.respondWith(
			caches.match(url.pathname).then(
				(hit) =>
					hit ??
					fetch(request).then((res) => {
						if (res.ok) {
							const copy = res.clone();
							event.waitUntil(caches.open(CACHE).then((cache) => cache.put(url.pathname, copy)));
						}
						return res;
					})
			)
		);
	}
});
