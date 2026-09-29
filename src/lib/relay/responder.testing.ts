// Test-only: a minimal Noise IK responder (the daemon's side), built from the
// same SymmetricState as the initiator. Not imported by the app.
import { x25519 } from '@noble/curves/ed25519.js';
import { SymmetricState, generateKeyPair, keyPairFromPrivate, PROLOGUE, type KeyPair, type Transport } from './noise';

/** A minimal IK responder built from the same SymmetricState, for tests. */
export function respond(
	s: KeyPair,
	msg1: Uint8Array,
	reply: (payload: Uint8Array, rs: Uint8Array) => Uint8Array,
	prologue = PROLOGUE,
	ephemeral?: Uint8Array
): { msg2: Uint8Array; transport: Transport; h: Uint8Array } {
	const ss = new SymmetricState();
	ss.mixHash(prologue);
	ss.mixHash(s.pub);
	const re = msg1.subarray(0, 32);
	ss.mixHash(re);
	ss.mixKey(x25519.getSharedSecret(s.priv, re));
	const rs = ss.decryptAndHash(msg1.subarray(32, 80));
	ss.mixKey(x25519.getSharedSecret(s.priv, rs));
	const payload = ss.decryptAndHash(msg1.subarray(80));
	const e = ephemeral ? keyPairFromPrivate(ephemeral) : generateKeyPair();
	ss.mixHash(e.pub);
	ss.mixKey(x25519.getSharedSecret(e.priv, re));
	ss.mixKey(x25519.getSharedSecret(e.priv, rs));
	const body = ss.encryptAndHash(reply(payload, rs));
	const msg2 = new Uint8Array(32 + body.length);
	msg2.set(e.pub);
	msg2.set(body, 32);
	const [c1, c2] = ss.split();
	return { msg2, transport: { send: c2, recv: c1 }, h: ss.h };
}

