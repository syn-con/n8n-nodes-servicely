import { createHash, timingSafeEqual } from 'crypto';
import { type IDataObject, type IWebhookFunctions, NodeOperationError } from 'n8n-workflow';

import {
	type JwtAlgorithm,
	JwtConfigurationError,
	JwtVerificationError,
	verifyJwt,
} from './jwt';

/** The authentication methods the credential can describe. */
export type AuthType = 'basicAuth' | 'headerAuth' | 'jwtAuth';

export const AUTH_CREDENTIAL_NAME = 'servicelyAiToolAuthApi';

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
			description: 'Set "Header Name" on the Servicely AI Tool Auth credential.',
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

function authenticateJwt(context: IWebhookFunctions, credential: AuthCredential): IDataObject {
	const usesPassphrase = (credential.keyType ?? 'passphrase') === 'passphrase';
	const key = usesPassphrase ? (credential.secret ?? '') : formatKey(credential.publicKey ?? '');
	if (!key) {
		throw new NodeOperationError(
			context.getNode(),
			`The credential is missing a ${usesPassphrase ? 'secret' : 'public key'}`,
			{ description: 'Complete the JWT Auth fields on the Servicely AI Tool Auth credential.' },
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

	try {
		return verifyJwt(token, { algorithm: credential.algorithm ?? 'HS256', key });
	} catch (error) {
		if (error instanceof JwtVerificationError) {
			throw new WebhookAuthorizationError(403, `Invalid JWT: ${error.message}`);
		}
		if (error instanceof JwtConfigurationError) {
			throw new NodeOperationError(context.getNode(), error.message);
		}
		throw error;
	}
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
				{ description: 'Pick a type on the Servicely AI Tool Auth credential.' },
			);
	}
}
