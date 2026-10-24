import { beforeEach, describe, expect, it, vi } from 'vitest';

const json = vi.fn();
vi.mock('$lib/web/api', () => ({ json: (...args: unknown[]) => json(...args) }));

import { Computers, platformName, type Computer } from './computers.svelte';

const mac: Computer = {
	host_id: 'A'.repeat(22),
	name: 'mac',
	platform: 'macos',
	version: '0.5.0',
	static_pub: 'P'.repeat(43),
	online: true,
	last_seen_at: '2026-10-23T10:00:00Z',
	created_at: '2026-10-01T10:00:00Z'
};
const pc: Computer = { ...mac, host_id: 'B'.repeat(22), name: 'pc', platform: 'windows', online: false };

beforeEach(() => json.mockReset());

describe('Computers', () => {
	it('lists the account’s computers', async () => {
		json.mockResolvedValueOnce({ computers: [mac, pc] });
		const computers = new Computers();
		await computers.refresh();
		expect(json).toHaveBeenCalledWith('/v1/oauth/computers');
		expect(computers.loaded).toBe(true);
		expect(computers.list.map((c) => c.name)).toEqual(['mac', 'pc']);
		expect(computers.get(pc.host_id)?.platform).toBe('windows');
	});

	it('keeps the last list and says why a refresh failed', async () => {
		json.mockResolvedValueOnce({ computers: [mac] });
		const computers = new Computers();
		await computers.refresh();
		json.mockRejectedValueOnce(new Error('HTTP 502'));
		await expect(computers.refresh()).rejects.toThrow('HTTP 502');
		expect(computers.error).toBe('HTTP 502');
		expect(computers.list).toHaveLength(1);
		json.mockResolvedValueOnce({});
		await computers.refresh();
		expect(computers.error).toBe('');
		expect(computers.list).toEqual([]);
	});

	it('renames on the account', async () => {
		json.mockResolvedValueOnce({ computers: [mac, pc] });
		const computers = new Computers();
		await computers.refresh();
		json.mockResolvedValueOnce({ ...mac, name: 'Work Mac' });
		await computers.rename(mac.host_id, '  Work Mac ');
		expect(json).toHaveBeenLastCalledWith(`/v1/oauth/computers/${mac.host_id}`, { method: 'PATCH', body: { name: 'Work Mac' } });
		expect(computers.list.map((c) => c.name)).toEqual(['Work Mac', 'pc']);
	});

	it('removes from the account', async () => {
		json.mockResolvedValueOnce({ computers: [mac, pc] });
		const computers = new Computers();
		await computers.refresh();
		json.mockResolvedValueOnce(undefined);
		await computers.remove(pc.host_id);
		expect(json).toHaveBeenLastCalledWith(`/v1/oauth/computers/${pc.host_id}`, { method: 'DELETE' });
		expect(computers.list.map((c) => c.name)).toEqual(['mac']);
	});

	it('keeps a computer whose removal failed', async () => {
		json.mockResolvedValueOnce({ computers: [pc] });
		const computers = new Computers();
		await computers.refresh();
		json.mockRejectedValueOnce(new Error('HTTP 500'));
		await expect(computers.remove(pc.host_id)).rejects.toThrow('HTTP 500');
		expect(computers.list).toHaveLength(1);
	});

	it('names platforms', () => {
		expect(platformName('macos')).toBe('macOS');
		expect(platformName('windows')).toBe('Windows');
		expect(platformName('linux')).toBe('Linux');
		expect(platformName('haiku')).toBe('haiku');
	});
});
