import { createHmac } from 'crypto';
import type { IDataObject, INodeProperties, IWebhookFunctions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { getAiAgents, getRoles } from '../../Servicely/SearchFunctions';
import { AUTH_CREDENTIAL_NAME, AUTH_CREDENTIAL_TEST } from '../authentication';
import { ServicelyAIToolTrigger } from '../ServicelyAIToolTrigger.node';

const node = new ServicelyAIToolTrigger();

/** The response node, as n8n types it once the package is installed. */
/** The Servicely action node set to answer the call, as `getChildNodes` reports it. */
const RESPONDER = {
	type: '@synergyconsulting/n8n-nodes-servicely.servicely',
	parameters: { resource: 'aiAgentTool', operation: 'sendResponse' },
};

interface WebhookStubOptions {
	params?: IDataObject;
	body?: unknown;
	/** Attached Servicely AI Agent Tool Auth credential; absent leaves the endpoint open. */
	credential?: IDataObject;
	headers?: Record<string, string>;
	/** The nodes downstream of the trigger, which decide the Respond wiring. */
	children?: Array<{ type: string; parameters?: Record<string, unknown> }>;
}

/** Minimal stand-in for the still open express response. */
function makeResponseStub() {
	const closeHandlers: Array<() => void> = [];
	return {
		headersSent: false,
		writableEnded: false,
		status: undefined as number | undefined,
		headers: undefined as Record<string, string> | undefined,
		payload: undefined as string | undefined,
		writeHead(status: number, headers: Record<string, string>) {
			this.status = status;
			this.headers = headers;
			this.headersSent = true;
		},
		end(payload?: string) {
			this.payload = payload;
			this.writableEnded = true;
		},
		on(event: string, handler: () => void) {
			if (event === 'close') {
				closeHandlers.push(handler);
			}
		},
		close() {
			for (const handler of closeHandlers) {
				handler();
			}
		},
	};
}

type ResponseStub = ReturnType<typeof makeResponseStub>;

const DEFAULTS: IDataObject = {
	prompt: 'Creates an incident',
	path: 'create-incident',
	responseMode: 'onReceived',
	onValidationError: 'respondError',
	parameters: {},
	options: {},
};

function makeWebhookCtx(options: WebhookStubOptions = {}) {
	const params = { ...DEFAULTS, ...options.params };
	const response = makeResponseStub();

	const ctx = {
		response,
		getNodeParameter: (name: string, fallback?: unknown) =>
			name in params ? params[name] : fallback,
		getResponseObject: () => response,
		getBodyData: () => options.body ?? {},
		getHeaderData: () => ({ 'content-type': 'application/json' }),
		getQueryData: () => ({}),
		getParamsData: () => ({}),
		getRequestObject: () => ({ headers: options.headers ?? {} }),
		getCredentials: async () => options.credential,
		getChildNodes: () =>
			(options.children ?? []).map((child, index) => ({ name: `node ${index}`, ...child })),
		getNode: () => ({
			name: 'Servicely AI Agent Tool',
			// Without an attached credential the endpoint takes any caller
			credentials:
				options.credential === undefined ? undefined : { servicelyAiToolAuthApi: { id: '1' } },
		}),
	};

	return ctx as unknown as IWebhookFunctions & { response: ResponseStub };
}

async function webhook(options: WebhookStubOptions = {}) {
	const ctx = makeWebhookCtx(options);
	const result = await node.webhook.call(ctx);
	return { result, response: ctx.response };
}

/** Reads a top level property off the node description. */
function property(name: string): INodeProperties {
	const found = node.description.properties.find((entry) => entry.name === name);
	if (found === undefined) {
		throw new Error(`the node has no "${name}" property`);
	}
	return found;
}

/** Reads an entry of the Options collection. */
function option(name: string): INodeProperties {
	const found = (property('options').options ?? []).find(
		(entry) => 'name' in entry && entry.name === name,
	);
	if (found === undefined) {
		throw new Error(`the node has no "${name}" option`);
	}
	return found as INodeProperties;
}

/**
 * One row of the Parameters fixedCollection. Each field is left out unless it is
 * given, the way n8n saves a row that was left at its default — so a row with no
 * `required` is exactly what a workflow written before the box existed holds.
 */
const parameterRow = (name: string, type?: string, description?: string, required?: boolean) => ({
	paramName: name,
	...(type === undefined ? {} : { paramType: type }),
	...(required === undefined ? {} : { paramRequired: required }),
	...(description === undefined ? {} : { paramDescription: description }),
});

describe('node description', () => {
	it('is a POST webhook trigger needing both the instance and the endpoint credential', () => {
		expect(node.description.name).toBe('servicelyAiAgentToolTrigger');
		expect(node.description.inputs).toEqual([]);
		expect(node.description.webhooks?.[0].httpMethod).toBe('POST');
		expect(node.description.credentials).toEqual([
			{ name: 'servicelyApi', displayName: 'Servicely API', required: true },
			{
				name: 'servicelyAiToolAuthApi',
				displayName: 'Servicely AI Agent Tool Auth',
				required: true,
				testedBy: 'servicelyAiToolAuthTest',
			},
		]);
	});

	it('registers the tool through the webhook lifecycle hooks', () => {
		expect(Object.keys(node.webhookMethods.default).sort()).toEqual([
			'checkExists',
			'create',
			'delete',
		]);
	});

	// The tool is registered under the node's own name, so there is nothing to ask.
	it('asks for the prompt before anything else, and for no tool name', () => {
		const named = node.description.properties
			.filter((entry) => entry.type !== 'notice')
			.map((entry) => entry.name);

		expect(named.slice(0, 3)).toEqual(['prompt', 'path', 'parameters']);
		expect(named).not.toContain('toolName');
		expect(property('prompt').required).toBe(true);
		expect(node.description.subtitle).toBe('={{"POST /" + $parameter["path"]}}');
	});

	// Both are the tool record's own flags, off unless the option is added and set.
	it('offers the two tool flags as toggles', () => {
		for (const name of ['mutatesTicket', 'productionRestricted']) {
			expect(option(name).type).toBe('boolean');
			expect(option(name).default).toBe(false);
		}
	});

	it('loads the Roles multi-select from the Role table', () => {
		const roles = option('roles');

		expect(roles.type).toBe('multiOptions');
		expect(roles.typeOptions?.loadOptionsMethod).toBe('getRoles');
		expect(roles.default).toEqual([]);
		expect(node.methods.loadOptions.getRoles).toBe(getRoles);
	});

	it('loads the AI Agents multi-select from the SystemAIAgent registry', () => {
		const agents = option('aiAgents');

		expect(agents.type).toBe('multiOptions');
		expect(agents.typeOptions?.loadOptionsMethod).toBe('getAiAgents');
		expect(agents.default).toEqual([]);
		expect(node.methods.loadOptions.getAiAgents).toBe(getAiAgents);
	});

	it('offers String, Number, Integer and Boolean as parameter types, with a description field', () => {
		const row = property('parameters').options?.[0] as { values: INodeProperties[] };
		const fields = row.values.map((entry) => entry.name);
		const types = row.values
			.find((entry) => entry.name === 'paramType')
			?.options?.map((option) => (option as { value: string }).value);

		expect(fields).toEqual([
			'paramDescription',
			'paramFromScript',
			'paramName',
			'paramRequired',
			'paramType',
		]);
		expect(types).toEqual(['boolean', 'integer', 'number', 'string']);
	});

	// A row saved before the box existed has no value for it, and every parameter
	// had to be sent then — so the ticked default is what keeps those tools strict.
	it('asks for an argument to be required by default', () => {
		const row = property('parameters').options?.[0] as { values: INodeProperties[] };
		const required = row.values.find((entry) => entry.name === 'paramRequired');

		expect(required?.type).toBe('boolean');
		expect(required?.default).toBe(true);
	});

	// The response is n8n's to send, exactly as for its own Webhook node: the
	// description says how, and the node never writes it.
	it('declares how a call is answered on its webhook', () => {
		const [webhookDescription] = node.description.webhooks ?? [];

		expect(webhookDescription.responseMode).toBe('={{$parameter["responseMode"]}}');
		expect(webhookDescription.responseCode).toContain('$parameter');
		expect(webhookDescription.responseData).toContain('$parameter');
		expect(property('responseMode').default).toBe('responseNode');
	});

	// The only deadline in play is the service desk's: n8n keeps the request open
	// for as long as the workflow runs, so the timeout is registration data and
	// asking for it under *Immediately* would be asking about a wait that is over.
	it('asks how long the service desk waits, for the modes that make it wait', () => {
		const timeout = property('responseTimeout');

		expect(timeout.displayName).toBe('Tool Timeout (Seconds)');
		expect(timeout.displayOptions?.show?.responseMode).toEqual(['lastNode', 'responseNode']);
		expect(timeout.default).toBe(60);
	});

	// The node has no input and is read on activation, so there is neither a `$json`
	// to reference nor an execution to resolve an expression against.
	it('offers no expression on any of its fields', () => {
		const expressible = (entries: INodeProperties[], path = ''): string[] =>
			entries.flatMap((entry) => {
				const nested = (entry.options ?? []).flatMap((option) =>
					typeof option === 'object' && 'values' in option
						? expressible(option.values as INodeProperties[], `${path}${entry.name}.`)
						: typeof option === 'object' && 'name' in option && 'type' in option
							? expressible([option as INodeProperties], `${path}${entry.name}.`)
							: [],
				);
				const self =
					entry.type !== 'notice' && entry.noDataExpression !== true
						? [`${path}${entry.name}`]
						: [];
				return [...self, ...nested];
			});

		expect(expressible(node.description.properties)).toEqual([]);
	});

	// The description spells the credential's name and its test's name out, because
	// n8n's verification scan reads that array statically and only sees literals.
	// These keep the literals and the constants behind them from drifting apart.
	it('names the auth credential and its test with the values the code uses', () => {
		const entry = (node.description.credentials ?? []).find(
			(candidate) => candidate.name === AUTH_CREDENTIAL_NAME,
		);

		expect(entry, `no credential entry named ${AUTH_CREDENTIAL_NAME}`).toBeDefined();
		expect(entry?.testedBy).toBe(AUTH_CREDENTIAL_TEST);
	});

	it('defines the credential test the description points at', () => {
		expect(node.methods?.credentialTest?.[AUTH_CREDENTIAL_TEST]).toBeTypeOf('function');
	});
});

describe('the credential test', () => {
	const runTest = (data: IDataObject) =>
		node.methods.credentialTest[AUTH_CREDENTIAL_TEST].call(
			{} as never,
			{ id: 'c1', name: 'auth', type: AUTH_CREDENTIAL_NAME, data } as never,
		);

	it('passes a credential that is complete', async () => {
		await expect(
			runTest({ type: 'headerAuth', headerName: 'X-API-KEY', headerValue: 'secret' }),
		).resolves.toMatchObject({ status: 'OK' });
	});

	it('names the field a credential is missing', async () => {
		await expect(runTest({ type: 'headerAuth', headerName: 'X-API-KEY' })).resolves.toMatchObject({
			status: 'Error',
			message: 'Set Header Value on this credential',
		});
		await expect(runTest({ type: 'basicAuth', user: 'ada' })).resolves.toMatchObject({
			status: 'Error',
		});
	});

	// The one check that is more than a presence test: a key the instance cannot read
	// would fail every call, and says so here instead
	it('rejects a public key that is not a PEM key', async () => {
		await expect(
			runTest({ type: 'jwtAuth', keyType: 'pemKey', publicKey: 'not a key' }),
		).resolves.toMatchObject({
			status: 'Error',
			message: 'Public Key is not a PEM key this instance can read',
		});
	});

	it('accepts a JWT credential with a secret', async () => {
		await expect(
			runTest({ type: 'jwtAuth', keyType: 'passphrase', secret: 'shhh' }),
		).resolves.toMatchObject({ status: 'OK' });
	});
});

describe('authentication', () => {
	it('rejects a call that does not satisfy the attached credential', async () => {
		const { result, response } = await webhook({
			credential: { type: 'headerAuth', headerName: 'X-API-KEY', headerValue: 'expected' },
		});

		expect(result).toEqual({ noWebhookResponse: true });
		expect(response.status).toBe(401);
		expect(JSON.parse(response.payload as string)).toEqual({
			success: false,
			error: { message: 'Missing "X-API-KEY" header' },
		});
	});

	it('answers a Basic challenge with the WWW-Authenticate header', async () => {
		const { response } = await webhook({
			credential: { type: 'basicAuth', user: 'ada', password: 'lovelace' },
		});

		expect(response.headers).toMatchObject({ 'WWW-Authenticate': 'Basic realm="Webhook"' });
	});

	it('passes the verified JWT payload on to the workflow', async () => {
		const secret = 'a-shared-secret';
		const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
		const signingInput = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: 'agent' })}`;
		const signature = createHmac('sha256', secret).update(signingInput).digest('base64url');

		const { result } = await webhook({
			credential: { type: 'jwtAuth', keyType: 'passphrase', secret, algorithm: 'HS256' },
			headers: { authorization: `Bearer ${signingInput}.${signature}` },
		});

		const [[item]] = result.workflowData as [[{ json: IDataObject }]];
		expect(item.json.jwt).toEqual({ sub: 'agent' });
	});

	it('lets a credential problem surface as a node error', async () => {
		// A headerAuth credential with no header name is misconfigured, not unauthorised
		await expect(webhook({ credential: { type: 'headerAuth' } })).rejects.toThrow(
			'The credential is missing a header name',
		);
	});
});

describe('validation', () => {
	it('starts the workflow with the declared parameters', async () => {
		const { result, response } = await webhook({
			params: {
				parameters: { values: [parameterRow('count', 'integer', 'How many')] },
			},
			body: { count: 2, IsLiveRun: true, extra: 'kept in body' },
		});

		expect(response.headersSent).toBe(false);
		const [[item]] = result.workflowData as [[{ json: IDataObject }]];
		expect(item.json.parameters).toEqual({ count: 2, IsLiveRun: true });
		expect(item.json.body).toEqual({ count: 2, IsLiveRun: true, extra: 'kept in body' });
		expect(item.json.validation).toEqual({ valid: true, errors: [] });
	});

	it('defaults an unset parameter type to string', async () => {
		const { result } = await webhook({
			params: { parameters: { values: [parameterRow('who')] } },
			body: { who: 'ada', IsLiveRun: false },
		});

		expect((result.workflowData as [[{ json: IDataObject }]])[0][0].json.parameters).toEqual({
			who: 'ada',
			IsLiveRun: false,
		});
	});

	it('rejects a missing parameter with 400 and does not start the workflow', async () => {
		const { result, response } = await webhook({
			params: { parameters: { values: [parameterRow('count', 'integer')] } },
			body: {},
		});

		expect(result).toEqual({ noWebhookResponse: true });
		expect(response.status).toBe(400);
		expect(JSON.parse(response.payload as string)).toEqual({
			success: false,
			error: {
				message: 'Request body validation failed',
				details: [{ key: 'count', message: 'Parameter "count" is required' }],
			},
		});
	});

	it('runs a call that leaves out a parameter that is not required', async () => {
		const { result, response } = await webhook({
			params: {
				parameters: {
					values: [
						parameterRow('count', 'integer'),
						parameterRow('note', 'string', 'Anything to add', false),
					],
				},
			},
			body: { count: 2 },
		});

		expect(response.headersSent).toBe(false);
		const [[item]] = result.workflowData as [[{ json: IDataObject }]];
		expect(item.json.validation).toEqual({ valid: true, errors: [] });
		// Absent rather than null, so the workflow reads it as unsent
		expect(item.json.parameters).toEqual({ count: 2 });
	});

	it('holds a parameter that is not required to its type when it is sent', async () => {
		const { response } = await webhook({
			params: {
				parameters: { values: [parameterRow('note', 'integer', 'A number, if you have one', false)] },
			},
			body: { note: 'not a number' },
		});

		expect(response.status).toBe(400);
		expect(JSON.parse(response.payload as string).error.details).toEqual([
			{ key: 'note', message: 'Parameter "note" must be an integer, but a string was received' },
		]);
	});

	it('runs the workflow anyway when configured to, passing the errors on', async () => {
		const { result } = await webhook({
			params: {
				onValidationError: 'continue',
				parameters: { values: [parameterRow('count', 'integer')] },
			},
			body: {},
		});

		const [[item]] = result.workflowData as [[{ json: IDataObject }]];
		expect(item.json.validation).toEqual({
			valid: false,
			errors: [{ key: 'count', message: 'Parameter "count" is required' }],
		});
	});

	// Every tool carries it, so a workflow can tell a real call from a rehearsal
	// without each tool having to declare it. It is exported but never validated:
	// no tool asked for it, so a caller that has not caught up is not rejected.
	it('runs a call that leaves IsLiveRun out', async () => {
		const { result, response } = await webhook({
			params: { parameters: { values: [parameterRow('count', 'integer')] } },
			body: { count: 2 },
		});

		expect(response.headersSent).toBe(false);
		const [[item]] = result.workflowData as [[{ json: IDataObject }]];
		expect(item.json.validation).toEqual({ valid: true, errors: [] });
		// Absent rather than assumed, so the workflow decides what that means
		expect(item.json.parameters).toEqual({ count: 2 });
	});

	it('passes IsLiveRun on without holding it to its type', async () => {
		const { result } = await webhook({ body: { IsLiveRun: 'yes' } });

		const [[item]] = result.workflowData as [[{ json: IDataObject }]];
		expect(item.json.validation).toEqual({ valid: true, errors: [] });
		expect(item.json.parameters).toEqual({ IsLiveRun: 'yes' });
	});

	it('coerces IsLiveRun when the node asks for coercion', async () => {
		const { result } = await webhook({
			params: { options: { coerceTypes: true } },
			body: { IsLiveRun: 'false' },
		});

		const [[item]] = result.workflowData as [[{ json: IDataObject }]];
		expect(item.json.parameters).toEqual({ IsLiveRun: false });
	});

	it('does not count IsLiveRun as an unknown parameter', async () => {
		const { result } = await webhook({
			params: { options: { allowUnknownParameters: false } },
			body: { IsLiveRun: true },
		});

		const [[item]] = result.workflowData as [[{ json: IDataObject }]];
		expect(item.json.validation).toEqual({ valid: true, errors: [] });
	});

	it('lets the node declare its own IsLiveRun instead', async () => {
		const { result } = await webhook({
			params: {
				parameters: { values: [parameterRow('IsLiveRun', 'string', 'The environment')] },
			},
			body: { IsLiveRun: 'staging' },
		});

		const [[item]] = result.workflowData as [[{ json: IDataObject }]];
		expect(item.json.parameters).toEqual({ IsLiveRun: 'staging' });
	});

	it('rejects a body that is not a JSON object', async () => {
		const { response } = await webhook({ body: [1, 2] });

		expect(response.status).toBe(400);
		expect(JSON.parse(response.payload as string).error.details).toEqual([
			{ key: '', message: 'The request body must be a JSON object' },
		]);
	});

	it('refuses a parameter without a name or defined twice', async () => {
		await expect(
			webhook({ params: { parameters: { values: [parameterRow(' ')] } } }),
		).rejects.toThrow('A parameter is defined without a name');

		await expect(
			webhook({
				params: { parameters: { values: [parameterRow('a'), parameterRow('a')] } },
			}),
		).rejects.toThrow('The parameter "a" is defined more than once');
	});

	it('refuses a type that is not one of the four supported ones', async () => {
		await expect(
			webhook({ params: { parameters: { values: [parameterRow('a', 'object')] } } }),
		).rejects.toThrow('The parameter "a" has an unknown type "object"');
	});
});

describe('response mode', () => {
	// n8n's own webhook layer sends the response for every mode; this node only
	// declares how, and hands it the body the immediate mode falls back to.
	it('leaves the request open and offers the default acknowledgement', async () => {
		const { result, response } = await webhook({ params: { responseMode: 'onReceived' } });

		expect(response.headersSent).toBe(false);
		expect(result.webhookResponse).toEqual({ success: true, message: 'Workflow was started' });
		expect(result.noWebhookResponse).toBeUndefined();
	});

	it('does not answer the waiting modes itself either', async () => {
		for (const responseMode of ['lastNode', 'responseNode']) {
			const children = responseMode === 'responseNode' ? [RESPONDER] : [];
			const { response } = await webhook({ params: { responseMode }, children });

			expect(response.headersSent).toBe(false);
		}
	});

	it('refuses a call the workflow could not answer', async () => {
		await expect(webhook({ params: { responseMode: 'responseNode' } })).rejects.toThrow(
			'No Servicely node set to "AI Agent Tool" found in the workflow',
		);

		await expect(
			webhook({ params: { responseMode: 'lastNode' }, children: [RESPONDER] }),
		).rejects.toThrow('Unused Servicely node set to "AI Agent Tool" found in the workflow');
	});

	// Checked before anything is read from the request, so a workflow that cannot
	// answer says so rather than authenticating a caller it will not reply to.
	it('checks the wiring before authenticating the caller', async () => {
		await expect(
			webhook({
				params: { responseMode: 'responseNode' },
				credential: { type: 'headerAuth', headerName: 'X-API-KEY', headerValue: 'expected' },
			}),
		).rejects.toThrow('No Servicely node set to "AI Agent Tool" found in the workflow');
	});
});
