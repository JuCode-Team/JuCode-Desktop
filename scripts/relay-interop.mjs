#!/usr/bin/env node
// Interop check of the PWA's Noise initiator (src/lib/relay/noise.ts) against
// the daemon's Rust responder, JuCode-CLI crates/daemon/examples/noise_peer.rs
// (docs/relay-protocol.md §6): handshake, then one frame larger than a chunk
// sent and echoed back.
//
//   node scripts/relay-interop.mjs                     # cargo run in ../JuCode-CLI
//   JUCODE_CLI=/path/to/JuCode-CLI node scripts/relay-interop.mjs
//   NOISE_PEER=/path/to/target/debug/examples/noise_peer node scripts/relay-interop.mjs
//
// Needs Node >= 23.6 (imports the .ts module directly) and, without
// NOISE_PEER, a Rust toolchain. The peer gets the responder's static private
// key (hex) as its last argument and speaks hex lines over stdio.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { FrameReader, Initiator, generateKeyPair, sealFrame } from '../src/lib/relay/noise.ts';

const cli = process.env.JUCODE_CLI ?? fileURLToPath(new URL('../../JuCode-CLI', import.meta.url));
const peer =
	process.env.NOISE_PEER ??
	`cargo run -q --manifest-path "${cli}/Cargo.toml" -p jucode-daemon --example noise_peer --`;

const host = generateKeyPair();
const child = spawn(`${peer} ${bytesToHex(host.priv)}`, { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '';
child.stderr.on('data', (chunk) => (stderr += chunk));
const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
async function next() {
	const line = await lines.next();
	if (line.done) throw new Error(`noise_peer exited early:\n${stderr}`);
	return hexToBytes(line.value.trim());
}
function check(ok, what) {
	if (!ok) throw new Error(`FAIL: ${what}`);
	console.log(`ok   ${what}`);
}

try {
	const initiator = new Initiator(generateKeyPair(), host.pub);
	const hello = JSON.stringify({ name: 'interop', pair: 'ABCD1234' });
	child.stdin.write(bytesToHex(initiator.writeMessage1(new TextEncoder().encode(hello))) + '\n');
	const { payload, transport } = initiator.readMessage2(await next());
	const reply = JSON.parse(new TextDecoder().decode(payload));
	check(reply.ok === true && reply.device === 'test', `handshake, msg 2 payload ${JSON.stringify(reply)}`);

	const frame = JSON.stringify({ op: 'echo', text: 'é'.repeat(40_000) + 'x'.repeat(10_000) });
	const messages = sealFrame(transport.send, frame);
	for (const message of messages) child.stdin.write(bytesToHex(message) + '\n');
	const reader = new FrameReader(transport.recv);
	let echoed = null;
	while (echoed === null) echoed = reader.push(await next());
	check(echoed === frame, `echo of a ${new TextEncoder().encode(frame).length}-byte frame in ${messages.length} chunks`);
	check(stderr.includes(`payload:${hello}`), 'peer saw the msg 1 payload');
	console.log('relay interop: all good');
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
} finally {
	child.stdin.end();
	child.kill();
}
