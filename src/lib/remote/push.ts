// Notifications on this phone (Web Push). The browser's subscription is
// made with the server's VAPID key and registered with the account
// (POST /v1/oauth/push/register), so every computer signed in to it can
// notify this browser through the server. The service worker shows them.

import { json } from '$lib/web/api';
import { deviceName } from '$lib/web/auth.svelte';

const ON = 'jucode-push-on';

/** This browser can be notified (an iPhone only from the Home Screen app). */
export function pushSupported(): boolean {
	return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** The user turned notifications on here and has not turned them off. */
export function pushOn(): boolean {
	try {
		return localStorage.getItem(ON) === '1' && Notification.permission === 'granted';
	} catch {
		return false;
	}
}

function urlKey(base64: string): Uint8Array<ArrayBuffer> {
	const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
	return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array): boolean {
	if (!a || a.byteLength !== b.byteLength) return false;
	const x = new Uint8Array(a);
	return x.every((v, i) => v === b[i]);
}

/** This browser's subscription with the server's key, made on first use. One
 *  made with another key (the old relay's) cannot be notified: made again. */
async function subscription(): Promise<PushSubscription> {
	const registration = await navigator.serviceWorker.ready;
	const { key } = await json<{ key: string }>('/v1/oauth/push/vapid-key');
	const server = urlKey(key);
	const existing = await registration.pushManager.getSubscription();
	if (existing && sameKey(existing.options.applicationServerKey, server)) return existing;
	await existing?.unsubscribe();
	return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: server });
}

async function register(): Promise<void> {
	const sub = (await subscription()).toJSON();
	await json<void>('/v1/oauth/push/register', {
		method: 'POST',
		body: { provider: 'webpush', subscription: { endpoint: sub.endpoint, keys: sub.keys }, device_name: deviceName() }
	});
}

/** Asks for permission and registers this browser with the account. */
export async function enablePush(): Promise<void> {
	if ((await Notification.requestPermission()) !== 'granted') throw new Error('notifications were not allowed');
	await register();
	localStorage.setItem(ON, '1');
}

/** Registers again when the page opens: the browser may have renewed the
 *  subscription meanwhile. */
export async function reregister(): Promise<void> {
	if (pushSupported() && pushOn()) await register();
}
