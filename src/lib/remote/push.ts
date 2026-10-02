// Notifications on this phone (Web Push). The browser's subscription is
// made with the relay's key (the relay sends the notifications, see
// jucode-relay push.go) and handed to each paired computer, which asks the
// relay to notify it (JuCode-CLI daemon push.rs). The service worker shows
// them.

import type { DaemonClient } from '$lib/daemon';

const ON = 'jucode-push-on';

/** This browser can be notified (an iPhone only from the Home Screen app). */
export function pushSupported(): boolean {
	return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** The user turned notifications on here and has not turned them off. It
 *  holds for every paired computer: one not yet subscribed gets the
 *  subscription when this phone next connects to it (`resubscribe`). */
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

/** This browser's subscription, made on first use. */
async function subscription(): Promise<PushSubscription> {
	const registration = await navigator.serviceWorker.ready;
	const existing = await registration.pushManager.getSubscription();
	if (existing) return existing;
	const res = await fetch('/relay/v1/push/key');
	if (!res.ok) throw new Error(`notifications are not available (${res.status})`);
	const { key } = (await res.json()) as { key: string };
	return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlKey(key) });
}

/** Asks for permission and subscribes this browser on `daemons`. */
export async function enablePush(daemons: DaemonClient[]): Promise<void> {
	if ((await Notification.requestPermission()) !== 'granted') throw new Error('notifications were not allowed');
	const sub = (await subscription()).toJSON();
	await Promise.all(daemons.map((d) => d.request({ op: 'push_subscribe', subscription: sub })));
	localStorage.setItem(ON, '1');
}

/** Hands the subscription to a computer again (its connection came back;
 *  the browser may have renewed the subscription meanwhile). */
export async function resubscribe(daemon: DaemonClient): Promise<void> {
	if (!pushSupported() || !pushOn()) return;
	const sub = (await subscription()).toJSON();
	await daemon.request({ op: 'push_subscribe', subscription: sub });
}
