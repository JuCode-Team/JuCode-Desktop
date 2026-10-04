import { describe, expect, it } from 'vitest';
import { gzipDataURL, logBundle, redact } from './feedback';

describe('feedback logs', () => {
	it('take secrets and the user name out', () => {
		const line = [
			'Authorization: Bearer abcdef0123456789',
			'{"access_token":"tok-very-secret","model":"gpt-6"}',
			'key=sk-ant-0123456789abcdef0123 url=https://x?token=abc123&page=2',
			'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijkl',
			'cwd /Users/alice/dev/app and /home/bob/x and C:\\Users\\carol\\proj'
		].join('\n');
		const out = redact(line);
		for (const secret of ['abcdef0123456789', 'tok-very-secret', 'sk-ant-0123456789', 'abc123', 'eyJhbGci', 'alice', 'bob', 'carol'])
			expect(out).not.toContain(secret);
		expect(out).toContain('"model":"gpt-6"');
		expect(out).toContain('page=2');
		expect(out).toContain('/Users/~/dev/app');
	});

	it('bundles the logs under their names and gzips them', async () => {
		const text = logBundle([
			{ name: 'jucode.log', text: 'one' },
			{ name: 'daemon.log', text: 'two' }
		]);
		expect(text).toBe('===== jucode.log =====\none\n\n===== daemon.log =====\ntwo');
		const url = await gzipDataURL(text);
		expect(url.startsWith('data:application/gzip;base64,')).toBe(true);
		const bytes = Uint8Array.from(atob(url.split(',')[1]), (c) => c.charCodeAt(0));
		const back = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
		expect(back).toBe(text);
	});
});
