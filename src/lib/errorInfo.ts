// An engine error in words a user can act on. The engines pass provider
// errors through raw (`unexpected status 401 Unauthorized: invalid token,
// url: …`); this names what went wrong, what to do, and which button does it.
// Unknown errors return null and show as they came.

export type ErrorAction = 'restart' | 'login' | 'account' | 'compact' | 'model';

export interface ErrorInfo {
	/** i18n key under `chat.err.<kind>` for the title and the hint. */
	kind: string;
	action?: ErrorAction;
	/** Named in the hint: the provider, the tool, the model. */
	subject?: string;
	/** The HTTP status and request id, when the raw text carries them. */
	status?: number;
	requestId?: string;
}

// The engines append their own sign-in hint to a 401; ours replaces it.
const ENGINE_HINT = /\s*\((?:Codex|Claude Code) needs to sign in again:[^)]*\)\s*$/;

/** The raw text without the engine's appended sign-in hint. */
export function stripEngineHint(raw: string): string {
	return raw.replace(ENGINE_HINT, '');
}

function statusOf(raw: string): number | undefined {
	const m =
		/\b(?:status(?: code)?|HTTP)\s*:?\s*(\d{3})\b/i.exec(raw) ??
		/\bAPI Error:\s*(\d{3})\b/i.exec(raw) ??
		/"status"\s*:\s*(\d{3})/.exec(raw);
	return m ? Number(m[1]) : undefined;
}

function requestIdOf(raw: string): string | undefined {
	return /request[ _-]?id["']?\s*[:=]\s*["']?([\w-]{8,})/i.exec(raw)?.[1];
}

/** `backend` is the session's engine (`jucode`, `claude`, `codex`, `acp`). */
export function describeError(raw: string, backend = ''): ErrorInfo | null {
	const text = stripEngineHint(raw);
	const low = text.toLowerCase();
	const status = statusOf(text);
	const requestId = requestIdOf(text);
	const info = (kind: string, action?: ErrorAction, subject?: string): ErrorInfo => ({
		kind,
		...(action ? { action } : {}),
		...(subject ? { subject } : {}),
		...(status ? { status } : {}),
		...(requestId ? { requestId } : {})
	});
	const tool = backend === 'claude' ? 'Claude Code' : backend === 'codex' ? 'Codex' : '';

	// History written by another account: its signed / encrypted parts do not
	// verify here (before the generic 400 below).
	if (/invalid[ `'"]*signature|signature.*thinking|encrypted content.*(verif|decrypt)|could not be verified/i.test(text))
		return info('foreignHistory');
	if (/model provider `?([^`\s]+)`? not found/i.test(text))
		return info('providerMissing', undefined, /model provider `?([^`\s]+)`?/i.exec(text)?.[1]);

	if (/not logged in to jucode|jucode session expired|run \/login/i.test(text)) return info('jucodeLogin', 'login');
	if (status === 401 || /\bunauthori[sz]ed\b|invalid[_ ](api[_ ])?(key|token)|token (is )?expired|authentication_error/i.test(low)) {
		// Through the JuCode gateway: the credential the session started with
		// ran out (it is handed over once, at start); a restart takes a new one.
		if (/jucode/i.test(text) || backend === 'jucode') return info('jucodeAuth', 'restart');
		return info('toolAuth', undefined, tool || undefined);
	}
	if (status === 402 || /insufficient[_ ](balance|quota|funds)|余额不足|quota exceeded|billing/i.test(text))
		return info('balance', 'account');
	if (/context[_ ]length|context window|prompt is too long|maximum context|too many tokens|input.*exceeds|上下文/i.test(text))
		return info('context', 'compact');
	if (status === 429 || /rate[ _-]?limit|too many requests|限流|请求过于频繁/i.test(text)) return info('rateLimit');
	if (status === 404 || /model[_ ]not[_ ]found|model .* (does not exist|not found|is not available)|no such model|unknown model/i.test(text))
		return info('model', 'model');
	if (
		(status !== undefined && status >= 500) ||
		/overloaded|bad gateway|service unavailable|gateway timeout|upstream|internal server error/i.test(low)
	)
		return info('upstream');
	if (
		/stream disconnected|stream closed before|response body closed|connection (reset|refused|closed|abort|error|failed)|econn|etimedout|enotfound|timed? ?out|network|dns|error sending request|broken pipe|unexpected eof|io error:|decoding chunk|exceeded retry limit/i.test(
			low
		)
	)
		return info('network');
	if (status === 403 || /forbidden|permission denied|not allowed/i.test(low)) return info('forbidden');
	if (status === 400 || /invalid_request|请求参数有误|bad request/i.test(text)) return info('badRequest');
	return null;
}
