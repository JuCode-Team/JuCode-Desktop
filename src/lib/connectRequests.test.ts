import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./protocol', () => ({ daemon: {} }));

import { ConnectRequests, clientKind } from './connectRequests.svelte';
import type { DaemonClient } from './daemon';

const request = vi.fn();
const store = () => new ConnectRequests({ request } as unknown as DaemonClient);
const phone = { type: 'connect_request', id: 'cr-1', name: 'iPhone', client: 'jucode-mobile', at: 1 };

beforeEach(() => request.mockReset());

describe('ConnectRequests', () => {
	it('shows a request until the daemon closes it, telling of it once', () => {
		const requests = store();
		const told = vi.fn();
		requests.onRequest = told;
		requests.handle(phone);
		requests.handle(phone);
		expect(requests.open).toEqual([{ id: 'cr-1', name: 'iPhone', client: 'jucode-mobile', at: 1 }]);
		expect(told).toHaveBeenCalledOnce();
		requests.handle({ type: 'connect_request_closed', id: 'cr-1', outcome: 'expired' });
		expect(requests.open).toEqual([]);
	});

	it('sends the decision and drops the request at once', async () => {
		const requests = store();
		requests.handle(phone);
		request.mockResolvedValueOnce({ type: 'connect_decided' });
		await requests.decide('cr-1', true);
		expect(request).toHaveBeenCalledWith({ op: 'connect_decide', request: 'cr-1', allow: true });
		expect(requests.open).toEqual([]);
	});

	it('takes the open requests when it connects', async () => {
		const requests = store();
		request.mockResolvedValueOnce({ type: 'connect_requests', requests: [{ id: 'cr-2', name: 'Chrome', client: 'jucode-web', at: 2 }, { name: 'no id' }] });
		await requests.sync();
		expect(request).toHaveBeenCalledWith({ op: 'connect_requests' });
		expect(requests.open.map((r) => r.id)).toEqual(['cr-2']);
	});

	it('keeps what it shows when the daemon does not know the op', async () => {
		const requests = store();
		requests.handle(phone);
		request.mockRejectedValueOnce(new Error('unknown op'));
		await requests.sync();
		request.mockResolvedValueOnce({ type: 'connect_requests' });
		await requests.sync();
		expect(requests.open.map((r) => r.id)).toEqual(['cr-1']);
	});

	it('names the kinds of client', () => {
		expect(clientKind('jucode-mobile')).toBe('settings.backend.clientMobile');
		expect(clientKind('jucode-web')).toBe('settings.backend.clientWeb');
		expect(clientKind('jucode-cli')).toBe('settings.backend.clientDesktop');
		expect(clientKind(undefined)).toBe('');
	});
});
