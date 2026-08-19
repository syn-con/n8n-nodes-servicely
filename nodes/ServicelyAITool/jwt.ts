import {
	constants,
	createHmac,
	createPublicKey,
	type KeyObject,
	timingSafeEqual,
	verify as verifyWithKey,
} from 'crypto';
import type { IDataObject } from 'n8n-workflow';

export type JwtAlgorithm =
	| 'ES256'
	| 'ES384'
	| 'ES512'
	| 'HS256'
	| 'HS384'
	| 'HS512'
	| 'PS256'
	| 'PS384'
	| 'PS512'
	| 'RS256'
	| 'RS384'
	| 'RS512';

/** The token itself is not acceptable - the caller must be rejected. */
export class JwtVerificationError extends Error {}

/** The configured key cannot be used at all - the node is misconfigured. */
export class JwtConfigurationError extends Error {}

/** Small allowance for clock drift between the token issuer and this instance. */
const CLOCK_TOLERANCE_SECONDS = 5;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * `JSON.parse` that answers `undefined` for text that is not JSON, so the caller
 * decides what a failure means outside a catch block. No valid JSON text parses to
 * `undefined`, so it is unambiguous as the failure answer.
 */
function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function decodeSegment(segment: string, what: string): IDataObject {
	const decoded = parseJson(Buffer.from(segment, 'base64url').toString('utf8'));
	if (decoded === undefined) {
		throw new JwtVerificationError(`the ${what} is not valid JSON`);
	}
	if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
		throw new JwtVerificationError(`the ${what} is not an object`);
	}
	return decoded as IDataObject;
}

/** Whether a PEM public key is one this instance can verify with at all. */
export function isUsablePublicKey(key: string): boolean {
	return readPublicKey(key) !== undefined;
}

/**
 * `createPublicKey` that answers `undefined` for anything that is not a usable PEM
 * key, so an unusable one is reported as a configuration problem from outside a
 * catch block rather than from inside one.
 */
function readPublicKey(key: string): KeyObject | undefined {
	try {
		return createPublicKey(key);
	} catch {
		return undefined;
	}
}

function hashOf(algorithm: JwtAlgorithm): 'sha256' | 'sha384' | 'sha512' {
	return `sha${algorithm.slice(2)}` as 'sha256' | 'sha384' | 'sha512';
}

function isSignatureValid(
	algorithm: JwtAlgorithm,
	signingInput: string,
	signature: Buffer,
	key: string,
): boolean {
	const hash = hashOf(algorithm);
	const data = Buffer.from(signingInput, 'utf8');

	if (algorithm.startsWith('HS')) {
		const expected = createHmac(hash, key).update(data).digest();
		return expected.length === signature.length && timingSafeEqual(expected, signature);
	}

	const publicKey = readPublicKey(key);
	if (!publicKey) {
		throw new JwtConfigurationError('The configured public key is not a valid PEM key');
	}

	if (algorithm.startsWith('PS')) {
		return verifyWithKey(
			hash,
			data,
			{
				key: publicKey,
				padding: constants.RSA_PKCS1_PSS_PADDING,
				saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
			},
			signature,
		);
	}

	if (algorithm.startsWith('ES')) {
		// JWS carries ECDSA signatures as raw r||s, not as the DER sequence Node expects by default.
		return verifyWithKey(hash, data, { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature);
	}

	return verifyWithKey(hash, data, publicKey, signature);
}

function assertNumericClaim(payload: IDataObject, claim: 'exp' | 'nbf'): number | undefined {
	const value = payload[claim];
	if (value === undefined || value === null) {
		return undefined;
	}
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new JwtVerificationError(`the "${claim}" claim is not a number`);
	}
	return value;
}

/**
 * Verifies a JSON Web Token and returns its payload.
 *
 * The algorithm is not read from the token but taken from the credential, so a caller cannot
 * downgrade the signature (for example to "none" or to HMAC over a public key).
 *
 * @throws {JwtVerificationError} when the token is malformed, unsigned by the expected key or expired
 * @throws {JwtConfigurationError} when the configured key cannot be used
 */
export function verifyJwt(
	token: string,
	options: { algorithm: JwtAlgorithm; key: string },
): IDataObject {
	const segments = token.split('.');
	if (segments.length !== 3) {
		throw new JwtVerificationError('the token is malformed');
	}

	const [encodedHeader, encodedPayload, encodedSignature] = segments;
	if (![encodedHeader, encodedPayload, encodedSignature].every((s) => BASE64URL_PATTERN.test(s))) {
		throw new JwtVerificationError('the token is not base64url encoded');
	}

	const header = decodeSegment(encodedHeader, 'token header');
	if (header.alg !== options.algorithm) {
		throw new JwtVerificationError(
			`the token is signed with "${String(header.alg)}" while "${options.algorithm}" is expected`,
		);
	}

	const signature = Buffer.from(encodedSignature, 'base64url');
	if (!isSignatureValid(options.algorithm, `${encodedHeader}.${encodedPayload}`, signature, options.key)) {
		throw new JwtVerificationError('the signature does not match');
	}

	const payload = decodeSegment(encodedPayload, 'token payload');
	const now = Math.floor(Date.now() / 1000);

	const expiresAt = assertNumericClaim(payload, 'exp');
	if (expiresAt !== undefined && now - CLOCK_TOLERANCE_SECONDS >= expiresAt) {
		throw new JwtVerificationError('the token has expired');
	}

	const notBefore = assertNumericClaim(payload, 'nbf');
	if (notBefore !== undefined && now + CLOCK_TOLERANCE_SECONDS < notBefore) {
		throw new JwtVerificationError('the token is not valid yet');
	}

	return payload;
}
