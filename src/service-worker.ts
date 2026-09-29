/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
// The phone PWA's offline shell: the built app, static files and the /remote
// page are cached at install, so the home-screen app opens without a network
// (it then waits for the relay). Registered only by the /remote page outside
// Tauri (svelte.config.js turns automatic registration off).
import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `jucode-shell-${version}`;
const SHELL = '/remote';
const ASSETS = [...build, ...files, SHELL];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(ASSETS))
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
	// Built and static files: cache first (build file names are hashed).
	if (ASSETS.includes(url.pathname)) {
		event.respondWith(caches.match(url.pathname).then((hit) => hit ?? fetch(request)));
	}
});
