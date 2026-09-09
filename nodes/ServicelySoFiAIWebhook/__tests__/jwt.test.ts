import { createHmac, generateKeyPairSync, sign as signWithKey, type KeyObject } from 'crypto';
import { describe, expect, it } from 'vitest';

import { JwtConfigurationError, JwtVerificationError, verifyJwt, type JwtAlgorithm } from '../jwt';

const SECRET = 'a-shared-secret';

const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

const now = () => Math.floor(Date.now() / 1000);

/** Builds a token the way an issuer would, so the verifier is exercised end to end. */
function makeToken(
	algorithm: JwtAlgorithm,
	payload: object,
	key: string | KeyObject = SECRET,
	options: { header?: object } = {},
) {
	const header = options.header ?? { alg: algorithm, typ: 'JWT' };
	const signingInput = `${encode(header)}.${encode(payload)}`;
	const data = Buffer.from(signingInput, 'utf8');

	let signature: Buffer;
	if (algorithm.startsWith('HS')) {
		signature = createHmac('sha256', key as string)
			.update(data)
			.digest();
	} else if (algorithm.startsWith('ES')) {
		signature = signWithKey('sha256', data, { key: key as KeyObject, dsaEncoding: 'ieee-p1363' });
	} else {
		signature = signWithKey('sha256', data, key as KeyObject);
	}

	return `${signingInput}.${signature.toString('base64url')}`;
}

describe('verifyJwt with a shared secret', () => {
	it('returns the payload of a token signed with the expected key', () => {
		const token = makeToken('HS256', { sub: 'agent', scope: 'tools' });

		expect(verifyJwt(token, { algorithm: 'HS256', key: SECRET })).toEqual({
			sub: 'agent',
			scope: 'tools',
		});
	});

	it('rejects a token signed with another key', () => {
		const token = makeToken('HS256', { sub: 'agent' }, 'another-secret');

		expect(() => verifyJwt(token, { algorithm: 'HS256', key: SECRET })).toThrow(
			'the signature does not match',
		);
	});

	it('rejects a token whose header claims a different algorithm', () => {
		const token = makeToken('HS256', { sub: 'agent' }, SECRET, {
			header: { alg: 'none', typ: 'JWT' },
		});

		expect(() => verifyJwt(token, { algorithm: 'HS256', key: SECRET })).toThrow(
			'the token is signed with "none" while "HS256" is expected',
		);
	});

	it('rejects a malformed token', () => {
		const verify = (token: string) => () => verifyJwt(token, { algorithm: 'HS256', key: SECRET });

		expect(verify('a.b')).toThrow('the token is malformed');
		expect(verify('a.b.c.d')).toThrow('the token is malformed');
		expect(verify('a+b.c.d')).toThrow('the token is not base64url encoded');
	});

	it('rejects a header or payload that is not a JSON object', () => {
		const notJson = `${Buffer.from('nope').toString('base64url')}.${encode({})}.sig`;
		expect(() => verifyJwt(notJson, { algorithm: 'HS256', key: SECRET })).toThrow(
			'the token header is not valid JSON',
		);

		const arrayHeader = `${encode([] as unknown as object)}.${encode({})}.sig`;
		expect(() => verifyJwt(arrayHeader, { algorithm: 'HS256', key: SECRET })).toThrow(
			'the token header is not an object',
		);

		const arrayPayload = makeToken('HS256', [] as unknown as object);
		expect(() => verifyJwt(arrayPayload, { algorithm: 'HS256', key: SECRET })).toThrow(
			'the token payload is not an object',
		);
	});

	it('honours exp and nbf, with a small allowance for clock drift', () => {
		const verify = (payload: object) => () =>
			verifyJwt(makeToken('HS256', payload), { algorithm: 'HS256', key: SECRET });

		expect(verify({ exp: now() - 60 })).toThrow('the token has expired');
		expect(verify({ nbf: now() + 60 })).toThrow('the token is not valid yet');
		expect(verify({ exp: now() + 60, nbf: now() - 60 })).not.toThrow();
		// Within the 5 second tolerance
		expect(verify({ exp: now() - 2, nbf: now() + 2 })).not.toThrow();
		expect(verify({ exp: 'soon' })).toThrow('the "exp" claim is not a number');
	});
});

describe('verifyJwt with a PEM key', () => {
	it('verifies an RS256 signature', () => {
		const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
		const token = makeToken('RS256', { sub: 'agent' }, privateKey);
		const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

		expect(verifyJwt(token, { algorithm: 'RS256', key: pem })).toEqual({ sub: 'agent' });
	});

	it('verifies an ES256 signature, which is raw r||s and not DER', () => {
		const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
		const token = makeToken('ES256', { sub: 'agent' }, privateKey);
		const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

		expect(verifyJwt(token, { algorithm: 'ES256', key: pem })).toEqual({ sub: 'agent' });
	});

	it('verifies a PS256 signature', () => {
		const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
		const signingInput = `${encode({ alg: 'PS256', typ: 'JWT' })}.${encode({ sub: 'agent' })}`;
		const signature = signWithKey('sha256', Buffer.from(signingInput, 'utf8'), {
			key: privateKey,
			padding: 6, // RSA_PKCS1_PSS_PADDING
			saltLength: 32,
		});
		const token = `${signingInput}.${signature.toString('base64url')}`;
		const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

		expect(verifyJwt(token, { algorithm: 'PS256', key: pem })).toEqual({ sub: 'agent' });
	});

	it('reports an unusable key as a configuration problem, not a bad token', () => {
		const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
		const token = makeToken('RS256', { sub: 'agent' }, privateKey);

		expect(() => verifyJwt(token, { algorithm: 'RS256', key: 'not-a-pem-key' })).toThrow(
			JwtConfigurationError,
		);
	});

	it('throws a verification error, not a configuration error, for a bad signature', () => {
		const token = makeToken('HS256', { sub: 'agent' }, 'another-secret');

		expect(() => verifyJwt(token, { algorithm: 'HS256', key: SECRET })).toThrow(
			JwtVerificationError,
		);
	});
});
