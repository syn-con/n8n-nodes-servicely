import type { IDataObject, INodeProperties, IWebhookFunctions } from 'n8n-workflow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAiAgents } from '../../Servicely/SearchFunctions';
import { ServicelyAITool } from '../ServicelyAITool.node';

const node = new ServicelyAITool();

interface WebhookStubOptions {
	params?: IDataObject;
	body?: unknown;
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
	toolName: 'create_incident',
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
		getRequestObject: () => ({ headers: {} }),
		// No credential attached, so the endpoint stays public
		getNode: () => ({ name: 'Servicely AI Tool', credentials: undefined }),
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
	it('is a POST webhook trigger that reads the instance and takes an optional auth credential', () => {
		expect(node.description.name).toBe('servicelyAiTool');
		expect(node.description.inputs).toEqual([]);
		expect(node.description.webhooks?.[0].httpMethod).toBe('POST');
		expect(node.description.credentials).toEqual([
			{ name: 'servicelyApi', required: true },
			{ name: 'servicelyAiToolAuthApi', required: false },
		]);
	});

	it('asks for the tool name and prompt before anything else', () => {
		const named = node.description.properties
			.filter((entry) => entry.type !== 'notice')
			.map((entry) => entry.name);

		expect(named.slice(0, 4)).toEqual(['toolName', 'prompt', 'aiAgents', 'path']);
		expect(property('toolName').required).toBe(true);
		expect(property('prompt').required).toBe(true);
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

	it('shows the timeout only when a response node answers', () => {
		expect(property('responseTimeout').displayOptions).toEqual({
			show: { responseMode: ['responseNode'] },
		});
		expect(property('responseTimeout').default).toBe(60);
	});
});

describe('validation', () => {
	it('starts the workflow with the declared parameters', async () => {
		const { result, response } = await webhook({
			params: {
				parameters: { values: [parameterRow('count', 'integer', 'How many')] },
			},
			body: { count: 2, extra: 'kept in body' },
		});

		expect(response.headersSent).toBe(false);
		const [[item]] = result.workflowData as [[{ json: IDataObject }]];
		expect(item.json.parameters).toEqual({ count: 2 });
		expect(item.json.body).toEqual({ count: 2, extra: 'kept in body' });
		expect(item.json.validation).toEqual({ valid: true, errors: [] });
	});

	it('defaults an unset parameter type to string', async () => {
		const { result } = await webhook({
			params: { parameters: { values: [parameterRow('who')] } },
			body: { who: 'ada' },
		});

		expect((result.workflowData as [[{ json: IDataObject }]])[0][0].json.parameters).toEqual({
			who: 'ada',
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

	it('does not arm a timer for the other response modes', async () => {
		const { response } = await webhook({ params: { responseMode: 'lastNode' } });

		vi.advanceTimersByTime(3_600_000);

		expect(response.headersSent).toBe(false);
	});
});
