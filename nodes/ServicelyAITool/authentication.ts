import { createHash, timingSafeEqual } from 'crypto';
import { type IDataObject, type IWebhookFunctions, NodeOperationError } from 'n8n-workflow';

import {
	isUsablePublicKey,
	type JwtAlgorithm,
	JwtConfigurationError,
	JwtVerificationError,
	verifyJwt,
} from './jwt';

/** The authentication methods the credential can describe. */
export type AuthType = 'basicAuth' | 'headerAuth' | 'jwtAuth';

export const AUTH_CREDENTIAL_NAME = 'servicelyAiToolAuthApi';

/**
 * Name of the node method behind the credential's **Test** button. The credential
 * entry names it in `testedBy`, and the trigger defines it under
 * `methods.credentialTest`, so the two are kept in step through this one constant.
 */
export const AUTH_CREDENTIAL_TEST = 'servicelyAiToolAuthTest';

/** The credential holds the fields of whichever `type` it describes. */
interface AuthCredential {
	type: AuthType;
	user?: string;
	password?: string;
	headerName?: string;
	headerValue?: string;
	keyType?: 'passphrase' | 'pemKey';
	secret?: string;
	publicKey?: string;
	algorithm?: JwtAlgorithm;
}

export interface AuthenticationResult {
	type: AuthType;
	/** Only set for JWT auth. */
	jwtPayload?: IDataObject;
}

/** Thrown when the incoming request may not start the workflow. */
export class WebhookAuthorizationError extends Error {
	constructor(
		readonly responseCode: number,
		message?: string,
		/** Extra headers the rejection has to carry, e.g. a Basic auth challenge. */
		readonly headers?: Record<string, string>,
	) {
		super(message ?? 'Authorization problem!');
		this.name = 'WebhookAuthorizationError';
	}
}

/**
 * What the credential's **Test** button reports. There is no service to call — this
 * credential describes what an *incoming* request must present — so the test answers
 * the one question that can be answered without a caller: whether the fields the
 * chosen type needs are filled in and usable, which is what otherwise surfaces as a
 * failed tool call at the worst moment.
 */
export function checkAuthCredential(credential: AuthCredential): string | undefined {
	switch (credential.type) {
		case 'basicAuth':
			return credential.user && credential.password
				? undefined
				: 'Set both User and Password on this credential';
		case 'headerAuth':
			if (!credential.headerName) {
				return 'Set Header Name on this credential';
			}
			return credential.headerValue ? undefined : 'Set Header Value on this credential';
		case 'jwtAuth': {
			const usesPassphrase = (credential.keyType ?? 'passphrase') === 'passphrase';
			if (usesPassphrase) {
				return credential.secret ? undefined : 'Set Secret on this credential';
			}
			if (!credential.publicKey) {
				return 'Set Public Key on this credential';
			}
			return isUsablePublicKey(formatKey(credential.publicKey))
				? undefined
				: 'Public Key is not a PEM key this instance can read';
		}
		default:
			return `Pick a Type on this credential ("${String(credential.type)}" is not one)`;
	}
}

/** Compares two secrets without leaking their length or content through timing. */
function safeEqual(actual: string, expected: string): boolean {
	const actualHash = createHash('sha256').update(actual).digest();
	const expectedHash = createHash('sha256').update(expected).digest();
	return timingSafeEqual(actualHash, expectedHash);
}

function readHeader(context: IWebhookFunctions, name: string): string | undefined {
	const value = context.getRequestObject().headers[name.toLowerCase()];
	if (value === undefined) {
		return undefined;
	}
	// A header sent more than once is ambiguous, so it never counts as a match.
	if (Array.isArray(value)) {
		return value.length === 1 ? value[0] : undefined;
	}
	return value;
}

/** Turns a PEM key pasted as a single line with escaped newlines back into a valid PEM block. */
function formatKey(key: string): string {
	return key.replace(/\\n/g, '\n').trim();
}

function authenticateBasic(context: IWebhookFunctions, credential: AuthCredential): void {
	const challenge = { 'WWW-Authenticate': 'Basic realm="Webhook"' };
	const header = readHeader(context, 'authorization');

	if (header === undefined || !header.toLowerCase().startsWith('basic ')) {
		throw new WebhookAuthorizationError(401, 'Missing "Basic" authorization header', challenge);
	}

	const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
	const separator = decoded.indexOf(':');
	if (separator === -1) {
		throw new WebhookAuthorizationError(401, 'Malformed "Basic" authorization header', challenge);
	}

	const user = decoded.slice(0, separator);
	const password = decoded.slice(separator + 1);

	// Both comparisons always run so a wrong user costs the same as a wrong password.
	const userMatches = safeEqual(user, credential.user ?? '');
	const passwordMatches = safeEqual(password, credential.password ?? '');
	if (!userMatches || !passwordMatches) {
		throw new WebhookAuthorizationError(403, 'Invalid credentials');
	}
}

function authenticateHeader(context: IWebhookFunctions, credential: AuthCredential): void {
	if (!credential.headerName) {
		throw new NodeOperationError(context.getNode(), 'The credential is missing a header name', {
			description: 'Set "Header Name" on the Servicely AI Agent Tool Auth credential.',
		});
	}

	const provided = readHeader(context, credential.headerName);
	if (provided === undefined) {
		throw new WebhookAuthorizationError(401, `Missing "${credential.headerName}" header`);
	}
	if (!safeEqual(provided, credential.headerValue ?? '')) {
		throw new WebhookAuthorizationError(403, 'Invalid credentials');
	}
}

/**
 * The verification's outcome, rather than its exception. {@link verifyJwt} raises a
 * type per kind of failure, and each kind is answered differently — a token the
 * caller must fix is a rejection, an unusable key is a node error — so the failure
 * is carried out of the catch block and the answer chosen where it can be read.
 */
type Verification =
	| { ok: true; payload: IDataObject }
	| { ok: false; failure: unknown };

function verify(token: string, options: { algorithm: JwtAlgorithm; key: string }): Verification {
	try {
		return { ok: true, payload: verifyJwt(token, options) };
	} catch (failure) {
		return { ok: false, failure };
	}
}

function authenticateJwt(context: IWebhookFunctions, credential: AuthCredential): IDataObject {
	const usesPassphrase = (credential.keyType ?? 'passphrase') === 'passphrase';
	const key = usesPassphrase ? (credential.secret ?? '') : formatKey(credential.publicKey ?? '');
	if (!key) {
		throw new NodeOperationError(
			context.getNode(),
			`The credential is missing a ${usesPassphrase ? 'secret' : 'public key'}`,
			{ description: 'Complete the JWT Auth fields on the Servicely AI Agent Tool Auth credential.' },
		);
	}

	const header = readHeader(context, 'authorization');
	if (header === undefined || !header.toLowerCase().startsWith('bearer ')) {
		throw new WebhookAuthorizationError(401, 'Missing "Bearer" authorization header');
	}

	const token = header.slice(7).trim();
	if (!token) {
		throw new WebhookAuthorizationError(401, 'Missing JWT');
	}

	const verification = verify(token, { algorithm: credential.algorithm ?? 'HS256', key });
	if (verification.ok) {
		return verification.payload;
	}

	const { failure } = verification;
	// A token this instance cannot trust is the caller's problem, and is answered as
	// one. A key it cannot use is the node's, and fails the execution instead — as
	// does anything the verifier raises that is neither, since that is a bug here.
	if (failure instanceof JwtVerificationError) {
		throw new WebhookAuthorizationError(403, `Invalid JWT: ${failure.message}`);
	}
	if (failure instanceof JwtConfigurationError) {
		throw new NodeOperationError(context.getNode(), failure.message);
	}
	throw new NodeOperationError(context.getNode(), failure as Error);
}

/**
 * Authenticates the incoming request with the method the attached credential describes.
 * Returns `undefined` when no credential is attached, which leaves the endpoint public.
 *
 * @throws {WebhookAuthorizationError} when the request must be rejected
 * @throws {NodeOperationError} when the credential is incomplete
 */
export async function authenticateRequest(
	context: IWebhookFunctions,
): Promise<AuthenticationResult | undefined> {
	if (context.getNode().credentials?.[AUTH_CREDENTIAL_NAME] === undefined) {
		return undefined;
	}

	const credential = await context.getCredentials<AuthCredential>(AUTH_CREDENTIAL_NAME);

	switch (credential.type) {
		case 'basicAuth':
			authenticateBasic(context, credential);
			return { type: 'basicAuth' };
		case 'headerAuth':
			authenticateHeader(context, credential);
			return { type: 'headerAuth' };
		case 'jwtAuth':
			return { type: 'jwtAuth', jwtPayload: authenticateJwt(context, credential) };
		default:
			throw new NodeOperationError(
				context.getNode(),
				`The credential has an unknown type "${String(credential.type)}"`,
				{ description: 'Pick a type on the Servicely AI Agent Tool Auth credential.' },
			);
	}
}
