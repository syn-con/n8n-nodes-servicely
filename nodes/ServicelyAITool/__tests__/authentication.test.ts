import { createHmac } from 'crypto';
import type { IWebhookFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import {
	AUTH_CREDENTIAL_NAME,
	authenticateRequest,
	WebhookAuthorizationError,
} from '../authentication';

type Headers = Record<string, string | string[] | undefined>;

/** Builds a context whose node has the given credential attached, or none at all. */
function makeCtx(credential: Record<string, unknown> | undefined, headers: Headers = {}) {
	return {
		getNode: () => ({
			name: 'Servicely AI Agent Tool',
			credentials: credential === undefined ? undefined : { [AUTH_CREDENTIAL_NAME]: { id: '1' } },
		}),
		getCredentials: async () => credential,
		getRequestObject: () => ({ headers }),
	} as unknown as IWebhookFunctions;
}

const basicHeader = (user: string, password: string) =>
	`Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

const SECRET = 'a-shared-secret';

function makeHsToken(payload: object) {
	const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
	const signingInput = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}`;
	const signature = createHmac('sha256', SECRET).update(signingInput).digest('base64url');
	return `${signingInput}.${signature}`;
}

/** Asserts the request was rejected with the given status. */
async function expectRejection(promise: Promise<unknown>, responseCode: number) {
	await expect(promise).rejects.toThrow(WebhookAuthorizationError);
	await promise.catch((error: WebhookAuthorizationError) => {
		expect(error.responseCode).toBe(responseCode);
	});
}

describe('no credential', () => {
	it('leaves the endpoint public', async () => {
		await expect(authenticateRequest(makeCtx(undefined))).resolves.toBeUndefined();
	});
});

describe('basic auth', () => {
	const credential = { type: 'basicAuth', user: 'ada', password: 'lovelace' };

	it('accepts the configured user and password', async () => {
		const ctx = makeCtx(credential, { authorization: basicHeader('ada', 'lovelace') });

		await expect(authenticateRequest(ctx)).resolves.toEqual({ type: 'basicAuth' });
	});

	it('challenges a request without the header', async () => {
		const ctx = makeCtx(credential);
		const promise = authenticateRequest(ctx);

		await expectRejection(promise, 401);
		await promise.catch((error: WebhookAuthorizationError) => {
			expect(error.headers).toEqual({ 'WWW-Authenticate': 'Basic realm="Webhook"' });
		});
	});

	it('rejects a header without a colon', async () => {
		const header = `Basic ${Buffer.from('ada').toString('base64')}`;

		await expectRejection(authenticateRequest(makeCtx(credential, { authorization: header })), 401);
	});

	it('rejects a wrong user or a wrong password with 403', async () => {
		await expectRejection(
			authenticateRequest(makeCtx(credential, { authorization: basicHeader('eve', 'lovelace') })),
			403,
		);
		await expectRejection(
			authenticateRequest(makeCtx(credential, { authorization: basicHeader('ada', 'wrong') })),
			403,
		);
	});
});

describe('header auth', () => {
	const credential = { type: 'headerAuth', headerName: 'X-API-KEY', headerValue: 'expected' };

	it('accepts the configured header, matched case-insensitively', async () => {
		const ctx = makeCtx(credential, { 'x-api-key': 'expected' });

		await expect(authenticateRequest(ctx)).resolves.toEqual({ type: 'headerAuth' });
	});

	it('rejects a missing header with 401 and a wrong value with 403', async () => {
		await expectRejection(authenticateRequest(makeCtx(credential)), 401);
		await expectRejection(authenticateRequest(makeCtx(credential, { 'x-api-key': 'nope' })), 403);
	});

	it('treats a header sent more than once as missing', async () => {
		const ctx = makeCtx(credential, { 'x-api-key': ['expected', 'expected'] });

		await expectRejection(authenticateRequest(ctx), 401);
	});

	it('reports a credential without a header name as a node error', async () => {
		const ctx = makeCtx({ type: 'headerAuth' }, { 'x-api-key': 'expected' });

		await expect(authenticateRequest(ctx)).rejects.toThrow(NodeOperationError);
	});
});

describe('jwt auth', () => {
	const credential = { type: 'jwtAuth', keyType: 'passphrase', secret: SECRET, algorithm: 'HS256' };

	it('returns the verified payload', async () => {
		const ctx = makeCtx(credential, { authorization: `Bearer ${makeHsToken({ sub: 'agent' })}` });

		await expect(authenticateRequest(ctx)).resolves.toEqual({
			type: 'jwtAuth',
			jwtPayload: { sub: 'agent' },
		});
	});

	it('rejects a missing bearer header or an empty token with 401', async () => {
		await expectRejection(authenticateRequest(makeCtx(credential)), 401);
		await expectRejection(
			authenticateRequest(makeCtx(credential, { authorization: 'Bearer   ' })),
			401,
		);
	});

	it('rejects a token signed with another key with 403', async () => {
		const ctx = makeCtx(
			{ ...credential, secret: 'another-secret' },
			{ authorization: `Bearer ${makeHsToken({ sub: 'agent' })}` },
		);

		await expectRejection(authenticateRequest(ctx), 403);
	});

	it('reports a credential without a secret or public key as a node error', async () => {
		const ctx = makeCtx(
			{ type: 'jwtAuth', keyType: 'passphrase' },
			{ authorization: `Bearer ${makeHsToken({})}` },
		);

		await expect(authenticateRequest(ctx)).rejects.toThrow(NodeOperationError);
	});

	it('turns an unusable PEM key into a node error, not a rejection', async () => {
		const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
		// The header has to claim RS256, otherwise the algorithm check rejects the token
		// before the configured key is ever used.
		const token = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ sub: 'agent' })}.c2ln`;
		const ctx = makeCtx(
			{ type: 'jwtAuth', keyType: 'pemKey', publicKey: 'not-a-pem\\nkey', algorithm: 'RS256' },
			{ authorization: `Bearer ${token}` },
		);

		await expect(authenticateRequest(ctx)).rejects.toThrow(NodeOperationError);
	});
});

describe('unknown credential type', () => {
	it('is a node error', async () => {
		await expect(authenticateRequest(makeCtx({ type: 'smokeSignals' }))).rejects.toThrow(
			'The credential has an unknown type "smokeSignals"',
		);
	});
});
