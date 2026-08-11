import { createHmac } from 'crypto';
import type { IDataObject, INodeProperties, IWebhookFunctions } from 'n8n-workflow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAiAgents } from '../../Servicely/SearchFunctions';
import { ServicelyAITool } from '../ServicelyAITool.node';

const node = new ServicelyAITool();

interface WebhookStubOptions {
	params?: IDataObject;
	body?: unknown;
	/** Attached Servicely AI Tool Auth credential; absent leaves the endpoint open. */
	credential?: IDataObject;
	headers?: Record<string, string>;
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
		// Every tool declares IsProduction, so a body without it fails validation —
		// the cases that are not about validation send the flag and nothing else
		getBodyData: () => options.body ?? { IsProduction: true },
		getHeaderData: () => ({ 'content-type': 'application/json' }),
		getQueryData: () => ({}),
		getParamsData: () => ({}),
		getRequestObject: () => ({ headers: options.headers ?? {} }),
		getCredentials: async () => options.credential,
		getNode: () => ({
			name: 'Servicely AI Tool',
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

/** One row of the Parameters fixedCollection. */
const parameterRow = (name: string, type?: string, description?: string) => ({
	paramName: name,
	...(type === undefined ? {} : { paramType: type }),
	...(description === undefined ? {} : { paramDescription: description }),
});

describe('node description', () => {
	it('is a POST webhook trigger needing both the instance and the endpoint credential', () => {
		expect(node.description.name).toBe('servicelyAiTool');
		expect(node.description.inputs).toEqual([]);
		expect(node.description.webhooks?.[0].httpMethod).toBe('POST');
		expect(node.description.credentials).toEqual([
			{ name: 'servicelyApi', displayName: 'Servicely API', required: true },
			{
				name: 'servicelyAiToolAuthApi',
				displayName: 'Servicely AI Tool Auth',
				required: true,
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

	// The tool is registered under the workflow's name, so the node asks for no
	// name of its own.
	it('asks for the prompt before anything else, and for no tool name', () => {
		const named = node.description.properties
			.filter((entry) => entry.type !== 'notice')
			.map((entry) => entry.name);

		expect(named.slice(0, 3)).toEqual(['prompt', 'aiAgents', 'path']);
		expect(named).not.toContain('toolName');
		expect(property('prompt').required).toBe(true);
		expect(node.description.subtitle).toBe('={{"POST /" + $parameter["path"]}}');
	});

	it('loads the AI Agents multi-select from the SystemAIAgent registry', () => {
		expect(property('aiAgents').type).toBe('multiOptions');
		expect(property('aiAgents').typeOptions?.loadOptionsMethod).toBe('getAiAgents');
		expect(property('aiAgents').default).toEqual([]);
		expect(node.methods.loadOptions.getAiAgents).toBe(getAiAgents);
	});

	it('offers String, Number, Integer and Boolean as parameter types, with a description field', () => {
		const row = property('parameters').options?.[0] as { values: INodeProperties[] };
		const fields = row.values.map((entry) => entry.name);
		const types = row.values
			.find((entry) => entry.name === 'paramType')
			?.options?.map((option) => (option as { value: string }).value);

		expect(fields).toEqual(['paramName', 'paramType', 'paramDescription']);
		expect(types).toEqual(['boolean', 'integer', 'number', 'string']);
	});

	it('titles the timeout after whatever the mode waits for, and shows it in both', () => {
		const timeouts = node.description.properties.filter(
			(entry) => entry.name === 'responseTimeout',
		);

		expect(
			timeouts.map((entry) => [entry.displayName, entry.displayOptions?.show?.responseMode]),
		).toEqual([
			['Response Node Timeout (Seconds)', ['responseNode']],
			['Workflow Timeout (Seconds)', ['lastNode']],
		]);
		// One name, so both variants read and write the same value
		expect(timeouts.map((entry) => entry.default)).toEqual([60, 60]);
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
			body: { count: 2, IsProduction: true, extra: 'kept in body' },
		});

		expect(response.headersSent).toBe(false);
		const [[item]] = result.workflowData as [[{ json: IDataObject }]];
		expect(item.json.parameters).toEqual({ count: 2, IsProduction: true });
		expect(item.json.body).toEqual({ count: 2, IsProduction: true, extra: 'kept in body' });
		expect(item.json.validation).toEqual({ valid: true, errors: [] });
	});

	it('defaults an unset parameter type to string', async () => {
		const { result } = await webhook({
			params: { parameters: { values: [parameterRow('who')] } },
			body: { who: 'ada', IsProduction: false },
		});

		expect((result.workflowData as [[{ json: IDataObject }]])[0][0].json.parameters).toEqual({
			who: 'ada',
			IsProduction: false,
		});
	});

	it('rejects a missing parameter with 400 and does not start the workflow', async () => {
		const { result, response } = await webhook({
			params: { parameters: { values: [parameterRow('count', 'integer')] } },
			body: { IsProduction: true },
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

	it('runs the workflow anyway when configured to, passing the errors on', async () => {
		const { result } = await webhook({
			params: {
				onValidationError: 'continue',
				parameters: { values: [parameterRow('count', 'integer')] },
			},
			body: { IsProduction: true },
		});

		const [[item]] = result.workflowData as [[{ json: IDataObject }]];
		expect(item.json.validation).toEqual({
			valid: false,
			errors: [{ key: 'count', message: 'Parameter "count" is required' }],
		});
	});

	// Every tool carries it, so a workflow can tell a real call from a rehearsal
	// without each tool having to declare it.
	it('declares IsProduction on top of the node\'s own parameters', async () => {
		const { result, response } = await webhook({
			params: { parameters: { values: [parameterRow('count', 'integer')] } },
			body: { count: 2 },
		});

		expect(response.status).toBe(400);
		expect(JSON.parse(response.payload as string).error.details).toEqual([
			{ key: 'IsProduction', message: 'Parameter "IsProduction" is required' },
		]);
		expect(result).toEqual({ noWebhookResponse: true });
	});

	it('takes only a boolean for IsProduction', async () => {
		const { response } = await webhook({ body: { IsProduction: 'yes' } });

		expect(JSON.parse(response.payload as string).error.details).toEqual([
			{
				key: 'IsProduction',
				message: 'Parameter "IsProduction" must be a boolean, but a string was received',
			},
		]);
	});

	it('lets the node declare its own IsProduction instead', async () => {
		const { result } = await webhook({
			params: {
				parameters: { values: [parameterRow('IsProduction', 'string', 'The environment')] },
			},
			body: { IsProduction: 'staging' },
		});

		const [[item]] = result.workflowData as [[{ json: IDataObject }]];
		expect(item.json.parameters).toEqual({ IsProduction: 'staging' });
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

describe('response timeout', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('answers 504 when the response node does not respond in time', async () => {
		const { response } = await webhook({
			params: { responseMode: 'responseNode', responseTimeout: 30 },
		});

		expect(response.headersSent).toBe(false);
		vi.advanceTimersByTime(30_000);

		expect(response.status).toBe(504);
		expect(JSON.parse(response.payload as string)).toEqual({
			success: false,
			error: { message: 'The workflow did not respond within 30 seconds' },
		});
	});

	it('stays quiet when the response node already answered', async () => {
		const { response } = await webhook({
			params: { responseMode: 'responseNode', responseTimeout: 30 },
		});

		// What n8n does when the response node sends its response
		response.writeHead(200, {});
		response.end('{}');
		response.close();
		vi.advanceTimersByTime(60_000);

		expect(response.status).toBe(200);
		expect(response.payload).toBe('{}');
	});

	it('answers 504 when the workflow itself does not finish in time', async () => {
		const { response } = await webhook({
			params: { responseMode: 'lastNode', responseTimeout: 30 },
		});

		vi.advanceTimersByTime(30_000);

		expect(response.status).toBe(504);
	});

	// "Immediately" has already answered by the time the webhook returns.
	it('does not arm a timer when the response is immediate', async () => {
		const { response } = await webhook({ params: { responseMode: 'onReceived' } });

		vi.advanceTimersByTime(3_600_000);

		expect(response.headersSent).toBe(false);
	});
});
