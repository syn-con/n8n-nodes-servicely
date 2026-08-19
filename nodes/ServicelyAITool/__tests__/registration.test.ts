import type { IDataObject, IHookFunctions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { DEFAULT_EXECUTION_SCRIPT, LIVE_RUN_PARAMETER } from '../parameters';
import { checkToolExists, createTool, deleteTool } from '../registration';

/** The wording of the flag every tool carries, as the agent reads it. */
const LIVE_RUN_DESCRIPTION = LIVE_RUN_PARAMETER.description;

/** The webhook URL the stub reports, which is what a script is registered with. */
const WEBHOOK_URL = 'https://n8n.example.com/webhook/create-incident';

/** The default script as it reaches the instance: its placeholder resolved. */
const RESOLVED_DEFAULT_SCRIPT = DEFAULT_EXECUTION_SCRIPT.replace(
	"'@@WEBHOOK_URL@@'",
	`'${WEBHOOK_URL}'`,
);

interface HookStubOptions {
	/** Responses handed out in order; the last one repeats. */
	responses?: Array<{ status: number; body?: unknown }>;
	workflow?: { id?: string; name?: string };
	/** The node the hooks register: its id is the tool's Key, its name the tool's Name. */
	node?: { id?: string; name?: string };
	/** What `getInstanceBaseUrl` answers, which is what the workflow link is built from. */
	instanceBaseUrl?: string;
	/** n8n passes 'manual' when a test webhook is created, 'internal' when it is torn down. */
	mode?: string;
	/** What `getNodeWebhookUrl` answers; the test base URL marks a test run. */
	webhookUrl?: string;
	params?: IDataObject;
	/**
	 * The agent table. Requests to either AI registry are answered from here (or
	 * from `assistants`) and recorded in `agentCalls`, off the positional queue —
	 * those syncs run alongside the parameter sync, so they must not shift what the
	 * queue hands it.
	 */
	agents?: IDataObject[];
	/** The assistant table, which behaves exactly as the agent one does. */
	assistants?: IDataObject[];
	/** Status for a registry list, for the cases where the table cannot be read. */
	agentListStatus?: number;
	/** Status for a registry write, for the case where the record is no longer there. */
	agentWriteStatus?: number;
}

/** Whether a URL addresses one of the two AI registries. */
const isAiRegistry = (url: string) =>
	url.startsWith('/v1/SystemAIAgent') || url.startsWith('/v1/SystemAIAssistant');

interface Call {
	method: string;
	url: string;
	body?: unknown;
	qs?: unknown;
}

function makeHookCtx(options: HookStubOptions = {}) {
	const responses = options.responses ?? [{ status: 200, body: { data: [] } }];
	const calls: Call[] = [];
	const agentCalls: Call[] = [];
	/** Every request, both channels, in the order they went out. */
	const sequence: string[] = [];
	const params: IDataObject = { prompt: 'Creates an incident', ...options.params };
	let n = 0;

	const warnings: string[] = [];
	const errors: string[] = [];

	const ctx = {
		calls,
		agentCalls,
		sequence,
		warnings,
		errors,
		logger: {
			debug: () => {},
			error: (message: string) => errors.push(message),
			warn: (message: string) => warnings.push(message),
		},
		getWorkflow: () => ({ id: 'wf-1', name: 'My Workflow', active: true, ...options.workflow }),
		getMode: () => options.mode ?? 'trigger',
		// `in`, not `??`, so a test can force the "no URL at all" case
		getNodeWebhookUrl: () =>
			'webhookUrl' in options
				? options.webhookUrl
				: 'https://n8n.example.com/webhook/create-incident',
		getNode: () => ({ id: 'node-7', name: 'Create Incident', ...options.node }),
		// `in`, so a test can force the "the instance does not know its URL" case
		getInstanceBaseUrl: () =>
			'instanceBaseUrl' in options ? options.instanceBaseUrl : 'https://n8n.example.com/',
		getNodeParameter: (name: string, fallback?: unknown) =>
			name in params ? params[name] : fallback,
		helpers: {
			httpRequestWithAuthentication: async (
				_credentialsType: string,
				request: { method: string; url: string; body?: unknown; qs?: unknown },
			) => {
				const call = {
					method: request.method,
					url: request.url,
					body: request.body,
					qs: request.qs,
				};

				sequence.push(`${request.method} ${request.url}`);

				if (isAiRegistry(request.url)) {
					agentCalls.push(call);
					// A GET lists the table; a PATCH only has to answer
					const isList = request.method === 'GET';
					const table = request.url.startsWith('/v1/SystemAIAssistant')
						? (options.assistants ?? [])
						: (options.agents ?? []);
					return {
						statusCode: (isList ? options.agentListStatus : options.agentWriteStatus) ?? 200,
						headers: {},
						body: { data: isList ? table : {} },
					};
				}

				calls.push(call);
				const step = responses[Math.min(n, responses.length - 1)];
				n += 1;
				return { statusCode: step.status, headers: {}, body: step.body };
			},
		},
	};

	return ctx as unknown as IHookFunctions & {
		calls: Call[];
		agentCalls: Call[];
		sequence: string[];
		warnings: string[];
		errors: string[];
	};
}

/** What a registered tool says about where it came from: the node, the workflow, its link. */
const DESCRIPTION =
	'Created by the "Create Incident" node of the n8n workflow "My Workflow" (https://n8n.example.com/workflow/wf-1)';

/** A 200 carrying Servicely's `{ data }` envelope. */
const ok = (data: unknown) => ({ status: 200, body: { data } });

/** What the API answers for a path whose table does not exist. */
const notFound = { status: 404, body: {} };

const TOOL = { id: 'tool-9', Key: 'node-7', Name: '[n8n] Create Incident' };

/** A Parameters collection as the node's fixedCollection stores it. */
const declares = (
	...rows: Array<{ name: string; type?: string; description?: string }>
): IDataObject => ({
	values: rows.map((row) => ({
		paramName: row.name,
		...(row.type === undefined ? {} : { paramType: row.type }),
		...(row.description === undefined ? {} : { paramDescription: row.description }),
	})),
});

describe('checkExists', () => {
	it('looks the tool up by Key on the tool table', async () => {
		const ctx = makeHookCtx({ responses: [ok([TOOL])] });

		await expect(checkToolExists.call(ctx)).resolves.toBe(true);
		expect(ctx.calls[0].method).toBe('GET');
		expect(ctx.calls[0].url).toBe('/v1/SystemAITool');
		expect(ctx.calls[0].qs).toEqual({
			query: JSON.stringify({ and: [{ fieldName: 'Key', operator: '=', value: 'node-7' }] }),
			page: 1,
			page_size: 1,
		});
	});

	it('reports the tool as missing when the Key matches nothing', async () => {
		const ctx = makeHookCtx({ responses: [ok([])] });

		await expect(checkToolExists.call(ctx)).resolves.toBe(false);
	});

	it('refuses to work on a node that has no id yet', async () => {
		const ctx = makeHookCtx({ node: { id: undefined } });

		await expect(checkToolExists.call(ctx)).rejects.toThrow('The node has no id yet');
	});

	// The Key is the node's, so the workflow not being saved is not this hook's problem
	it('looks a tool up for a workflow that has no id', async () => {
		const ctx = makeHookCtx({ responses: [ok([TOOL])], workflow: { id: undefined } });

		await expect(checkToolExists.call(ctx)).resolves.toBe(true);
	});

	it('reads a 404 as "no tool", not as a failure', async () => {
		const ctx = makeHookCtx({ responses: [notFound] });

		await expect(checkToolExists.call(ctx)).resolves.toBe(false);
	});
});

describe('create', () => {
	it('posts the tool keyed by the node id, named after the node', async () => {
		const ctx = makeHookCtx({ responses: [ok([]), ok({ id: 'tool-9' })] });

		await expect(createTool.call(ctx)).resolves.toBe(true);
		expect(ctx.calls[0].method).toBe('GET');
		expect(ctx.calls[1].method).toBe('POST');
		expect(ctx.calls[1].url).toBe('/v1/SystemAITool');
		expect(ctx.calls[1].body).toEqual({
			Key: 'node-7',
			Name: '[n8n] Create Incident',
			Active: true,
			SelectionPrompt: 'Creates an incident',
			Description: DESCRIPTION,
			TimeoutSeconds: 60,
			ExecutionScript: RESOLVED_DEFAULT_SCRIPT,
		});
	});

	it('patches the existing record instead, leaving its Key alone', async () => {
		const ctx = makeHookCtx({
			responses: [ok([TOOL]), ok({ id: 'tool-9' })],
			params: { prompt: 'Creates an incident, now with feeling' },
		});

		await expect(createTool.call(ctx)).resolves.toBe(true);
		expect(ctx.calls[1].method).toBe('PATCH');
		expect(ctx.calls[1].url).toBe('/v1/SystemAITool/tool-9');
		expect(ctx.calls[1].body).toEqual({
			Name: '[n8n] Create Incident',
			Active: true,
			SelectionPrompt: 'Creates an incident, now with feeling',
			Description: DESCRIPTION,
			TimeoutSeconds: 60,
			ExecutionScript: RESOLVED_DEFAULT_SCRIPT,
		});
	});

	// The roles are the tool's own field, not a link held by the roles, so they are
	// written with the record rather than reconciled like the agents and assistants.
	it('sends the selected roles as the tool\'s Roles', async () => {
		const ctx = makeHookCtx({
			responses: [ok([TOOL]), ok({ id: 'tool-9' })],
			params: { options: { roles: ['role-1', 'role-2'] } },
		});

		await createTool.call(ctx);

		expect(ctx.calls[1].body).toMatchObject({ Roles: ['role-1', 'role-2'] });
	});

	it('empties the roles when the option is there with nothing selected', async () => {
		const ctx = makeHookCtx({
			responses: [ok([TOOL]), ok({ id: 'tool-9' })],
			params: { options: { roles: [] } },
		});

		await createTool.call(ctx);

		expect(ctx.calls[1].body).toMatchObject({ Roles: [] });
	});

	// Saying nothing about roles is not asking for the ones a service desk set to go.
	it('leaves the roles out entirely when the option was never added', async () => {
		const ctx = makeHookCtx({ responses: [ok([TOOL]), ok({ id: 'tool-9' })] });

		await createTool.call(ctx);

		expect(ctx.calls[1].body).not.toHaveProperty('Roles');
	});

	it('sends the tool flags the node sets, on and off', async () => {
		const ctx = makeHookCtx({
			responses: [ok([TOOL]), ok({ id: 'tool-9' })],
			params: { options: { mutatesTicket: true, productionRestricted: false } },
		});

		await createTool.call(ctx);

		expect(ctx.calls[1].body).toMatchObject({
			MutatesTicket: true,
			ProductionRestricted: false,
		});
	});

	// Same reasoning as the roles: what the node never mentions, it does not rewrite.
	it('leaves both flags out when neither option was added', async () => {
		const ctx = makeHookCtx({ responses: [ok([TOOL]), ok({ id: 'tool-9' })] });

		await createTool.call(ctx);

		expect(ctx.calls[1].body).not.toHaveProperty('MutatesTicket');
		expect(ctx.calls[1].body).not.toHaveProperty('ProductionRestricted');
	});

	it('sends one flag without the other', async () => {
		const ctx = makeHookCtx({
			responses: [ok([TOOL]), ok({ id: 'tool-9' })],
			params: { options: { productionRestricted: true } },
		});

		await createTool.call(ctx);

		expect(ctx.calls[1].body).toMatchObject({ ProductionRestricted: true });
		expect(ctx.calls[1].body).not.toHaveProperty('MutatesTicket');
	});

	// A tool with no script would be registered and then do nothing, so the default
	// is what a node that says nothing gets.
	it('falls back to the default Execution Script, with its URL resolved', async () => {
		const ctx = makeHookCtx({ responses: [ok([TOOL]), ok({ id: 'tool-9' })] });

		await createTool.call(ctx);

		const { ExecutionScript } = ctx.calls[1].body as IDataObject;
		expect(ExecutionScript).toBe(RESOLVED_DEFAULT_SCRIPT);
		expect(ExecutionScript).not.toContain('@@WEBHOOK_URL@@');
		// The script quoted the placeholder itself, so no second pair was added
		expect(ExecutionScript).toContain(`let url = '${WEBHOOK_URL}';`);
	});

	it('falls back to the default when the option is left blank', async () => {
		const ctx = makeHookCtx({
			responses: [ok([TOOL]), ok({ id: 'tool-9' })],
			params: { options: { executionScript: '   ' } },
		});

		await createTool.call(ctx);

		expect((ctx.calls[1].body as IDataObject).ExecutionScript).toContain('HTTP.post(url)');
	});

	it('sends the Execution Script with the tool', async () => {
		const ctx = makeHookCtx({
			responses: [ok([TOOL]), ok({ id: 'tool-9' })],
			params: { options: { executionScript: 'servicely.log("called")' } },
		});

		await createTool.call(ctx);

		expect(ctx.calls[1].body).toMatchObject({ ExecutionScript: 'servicely.log("called")' });
	});

	it("replaces @@WEBHOOK_URL@@ with the tool's quoted webhook URL, every time it appears", async () => {
		const ctx = makeHookCtx({
			responses: [ok([TOOL]), ok({ id: 'tool-9' })],
			params: { options: { executionScript: 'post(@@WEBHOOK_URL@@); retry(@@WEBHOOK_URL@@)' } },
		});

		await createTool.call(ctx);

		expect(ctx.calls[1].body).toMatchObject({
			ExecutionScript:
				"post('https://n8n.example.com/webhook/create-incident'); retry('https://n8n.example.com/webhook/create-incident')",
		});
	});

	// Scripts saved before the placeholder said what it stood for are already out
	// there, and one left unresolved would register and then fail on a literal
	it('still resolves the legacy @@URL@@ spelling, quoted or bare', async () => {
		const ctx = makeHookCtx({
			responses: [ok([TOOL]), ok({ id: 'tool-9' })],
			params: { options: { executionScript: "post('@@URL@@'); retry(@@URL@@)" } },
		});

		await createTool.call(ctx);

		const url = 'https://n8n.example.com/webhook/create-incident';
		expect(ctx.calls[1].body).toMatchObject({
			ExecutionScript: `post('${url}'); retry('${url}')`,
		});
	});

	it('resolves both spellings in one script', async () => {
		const ctx = makeHookCtx({
			responses: [ok([TOOL]), ok({ id: 'tool-9' })],
			params: { options: { executionScript: 'post(@@WEBHOOK_URL@@); retry(@@URL@@)' } },
		});

		await createTool.call(ctx);

		const url = 'https://n8n.example.com/webhook/create-incident';
		expect(ctx.calls[1].body).toMatchObject({
			ExecutionScript: `post('${url}'); retry('${url}')`,
		});
	});

	it('leaves the quotes alone when the script already quoted the placeholder', async () => {
		const ctx = makeHookCtx({
			responses: [ok([TOOL]), ok({ id: 'tool-9' })],
			params: {
				options: { executionScript: "post('@@WEBHOOK_URL@@'); log(\"@@WEBHOOK_URL@@\"); retry(@@WEBHOOK_URL@@)" },
			},
		});

		await createTool.call(ctx);

		const url = 'https://n8n.example.com/webhook/create-incident';
		expect(ctx.calls[1].body).toMatchObject({
			ExecutionScript: `post('${url}'); log("${url}"); retry('${url}')`,
		});
	});

	// The script picks its endpoint at call time, so it is given the production URL
	// even when a test listen is what registered the tool.
	it('resolves the placeholder to the production URL during a test listen', async () => {
		const ctx = makeHookCtx({
			mode: 'manual',
			webhookUrl: 'https://n8n.example.com/webhook-test/create-incident',
			responses: [ok([TOOL]), ok({ id: 'tool-9' })],
			params: { options: { executionScript: 'post(@@WEBHOOK_URL@@)' } },
		});

		await createTool.call(ctx);

		expect(ctx.calls[1].body).toMatchObject({
			ExecutionScript: "post('https://n8n.example.com/webhook/create-incident')",
		});
	});

	it('refuses to register a script whose URL cannot be resolved', async () => {
		const ctx = makeHookCtx({
			webhookUrl: undefined,
			params: { options: { executionScript: 'post(@@WEBHOOK_URL@@)' } },
		});

		await expect(createTool.call(ctx)).rejects.toThrow(
			"webhook URL could not be resolved",
		);
		// Nothing was written
		expect(ctx.calls).toHaveLength(0);
	});

	// The service desk's patience is the only deadline there is, so the node's Tool
	// Timeout is what it has to be given.
	it('mirrors the Tool Timeout into TimeoutSeconds', async () => {
		const ctx = makeHookCtx({
			responses: [ok([TOOL]), ok({ id: 'tool-9' })],
			params: { responseTimeout: 120 },
		});

		await createTool.call(ctx);

		expect(ctx.calls[1].body).toMatchObject({ TimeoutSeconds: 120 });
	});

	// The record always carries a timeout, so an unusable value has to become one:
	// an emptied box, or an expression that resolved to nothing.
	it('falls back to the default timeout when the node has no usable one', async () => {
		for (const responseTimeout of ['', 'soon', 0, -1]) {
			const ctx = makeHookCtx({
				responses: [ok([TOOL]), ok({ id: 'tool-9' })],
				params: { responseTimeout },
			});

			await createTool.call(ctx);

			expect(ctx.calls[1].body).toMatchObject({ TimeoutSeconds: 60 });
		}
	});

	it('reactivates a record someone had switched off', async () => {
		const ctx = makeHookCtx({ responses: [ok([{ ...TOOL, Active: false }]), ok({})] });

		await createTool.call(ctx);

		expect(ctx.calls[1].body).toMatchObject({ Active: true });
	});

	it('renames the tool with the node', async () => {
		const ctx = makeHookCtx({
			responses: [ok([TOOL]), ok({ id: 'tool-9' })],
			node: { name: 'Close Incident' },
		});

		await createTool.call(ctx);

		expect(ctx.calls[1].body).toMatchObject({
			Name: '[n8n] Close Incident',
			Description:
				'Created by the "Close Incident" node of the n8n workflow "My Workflow" (https://n8n.example.com/workflow/wf-1)',
		});
	});

	// Whatever the description cannot resolve is left out rather than named as unknown
	it('names the workflow by its id when it has no name', async () => {
		const ctx = makeHookCtx({
			responses: [ok([]), ok({ id: 'tool-9' })],
			workflow: { name: undefined },
		});

		await createTool.call(ctx);

		expect(ctx.calls[1].body).toMatchObject({
			Name: '[n8n] Create Incident',
			Description:
				'Created by the "Create Incident" node of the n8n workflow "wf-1" (https://n8n.example.com/workflow/wf-1)',
		});
	});

	it('leaves the link out when the instance does not say where it is reachable', async () => {
		const ctx = makeHookCtx({
			responses: [ok([]), ok({ id: 'tool-9' })],
			instanceBaseUrl: '',
		});

		await createTool.call(ctx);

		expect(ctx.calls[1].body).toMatchObject({
			Description: 'Created by the "Create Incident" node of the n8n workflow "My Workflow"',
		});
	});

	it('links to the workflow whether or not the base URL ends in a slash', async () => {
		const ctx = makeHookCtx({
			responses: [ok([]), ok({ id: 'tool-9' })],
			instanceBaseUrl: 'https://n8n.example.com',
		});

		await createTool.call(ctx);

		expect(ctx.calls[1].body).toMatchObject({ Description: DESCRIPTION });
	});

	it('sends an empty SelectionPrompt when the node has no prompt', async () => {
		const ctx = makeHookCtx({
			responses: [ok([]), ok({ id: 'tool-9' }), ok([])],
			params: { prompt: undefined },
		});

		await createTool.call(ctx);

		expect(ctx.calls[1].body).toMatchObject({ SelectionPrompt: '' });
	});

	it('names the table when the POST target does not exist', async () => {
		const ctx = makeHookCtx({ responses: [notFound] });

		await expect(createTool.call(ctx)).rejects.toThrow(
			'Could not write to "SystemAITool" on this Servicely instance',
		);
	});

	it('looks the tool up again when the write echoes no record', async () => {
		const ctx = makeHookCtx({ responses: [ok([]), ok({}), ok([TOOL]), ok([])] });

		await expect(createTool.call(ctx)).resolves.toBe(true);
		expect(ctx.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
			'GET /v1/SystemAITool',
			'POST /v1/SystemAITool',
			'GET /v1/SystemAITool',
			'GET /v1/SystemAIToolParameter',
			// The IsLiveRun row every tool gets
			'POST /v1/SystemAIToolParameter',
		]);
	});

	it('refuses to carry on when the tool id cannot be resolved', async () => {
		const ctx = makeHookCtx({ responses: [ok([]), ok({}), ok([])] });

		await expect(createTool.call(ctx)).rejects.toThrow(
			'The registered Servicely AI Agent Tool has no id',
		);
	});
});

describe('parameter sync', () => {
	/** The tool already exists, so create patches it and then reconciles parameters. */
	function ctxFor(existingParameters: IDataObject[], params: IDataObject = {}) {
		return makeHookCtx({
			responses: [ok([TOOL]), ok(TOOL), ok(existingParameters), ok({})],
			params,
		});
	}

	it('creates a row per declared parameter, ordered from 10 in steps of 10', async () => {
		const ctx = ctxFor([], {
			parameters: declares(
				{ name: 'ticketId', type: 'string', description: 'Which ticket' },
				{ name: 'priority', type: 'integer', description: 'How urgent' },
			),
		});

		await createTool.call(ctx);

		const writes = ctx.calls.filter((call) => call.url.startsWith('/v1/SystemAIToolParameter'));
		expect(writes.map((call) => call.method)).toEqual(['GET', 'POST', 'POST', 'POST']);
		expect(writes[1].body).toEqual({
			Name: 'ticketId',
			Type: 'string',
			Description: 'Which ticket',
			Order: 10,
			Parent: 'tool-9',
		});
		expect(writes[2].body).toEqual({
			Name: 'priority',
			Type: 'integer',
			Description: 'How urgent',
			Order: 20,
			Parent: 'tool-9',
		});
		// Appended last, so declaring a parameter later does not reorder it
		expect(writes[3].body).toMatchObject({ Name: 'IsLiveRun', Type: 'boolean', Order: 30 });
	});

	it('writes the IsLiveRun row for a tool that declares nothing', async () => {
		const ctx = ctxFor([]);

		await createTool.call(ctx);

		const writes = ctx.calls.filter((call) => call.method === 'POST');
		expect(writes).toHaveLength(1);
		expect(writes[0].body).toEqual({
			Name: 'IsLiveRun',
			Type: 'boolean',
			Description:
				'Whether this call should really run. Always send true, unless the user explicitly asked to run in test mode — then send false.',
			Order: 10,
			Parent: 'tool-9',
		});
	});

	it('queries the existing rows by their parent tool', async () => {
		const ctx = ctxFor([], { parameters: declares({ name: 'ticketId' }) });

		await createTool.call(ctx);

		const lookup = ctx.calls.find((call) => call.url === '/v1/SystemAIToolParameter');
		expect(lookup?.qs).toEqual({
			query: JSON.stringify({ and: [{ fieldName: 'Parent', operator: '=', value: 'tool-9' }] }),
			page: 1,
			page_size: 200,
		});
	});

	it('leaves a row that already matches untouched', async () => {
		const ctx = ctxFor(
			[
				{ id: 'p1', Name: 'ticketId', Type: 'string', Description: 'Which ticket', Order: 10 },
				{
					id: 'p2',
					Name: 'IsLiveRun',
					Type: 'boolean',
					Description: LIVE_RUN_DESCRIPTION,
					Order: 20,
				},
			],
			{ parameters: declares({ name: 'ticketId', type: 'string', description: 'Which ticket' }) },
		);

		await createTool.call(ctx);

		// The lookup, and no write at all
		expect(ctx.calls.filter((call) => call.url.startsWith('/v1/SystemAIToolParameter'))).toHaveLength(
			1,
		);
	});

	it('patches a row whose type or description changed', async () => {
		const ctx = ctxFor(
			[{ id: 'p1', Name: 'priority', Type: 'string', Description: 'stale', Order: 10 }],
			{ parameters: declares({ name: 'priority', type: 'integer', description: 'How urgent' }) },
		);

		await createTool.call(ctx);

		const write = ctx.calls[3];
		expect(write.method).toBe('PATCH');
		expect(write.url).toBe('/v1/SystemAIToolParameter/p1');
		expect(write.body).toEqual({
			Name: 'priority',
			Type: 'integer',
			Description: 'How urgent',
			Order: 10,
		});
	});

	it('patches a row that only moved position', async () => {
		const ctx = ctxFor(
			[
				{ id: 'p1', Name: 'a', Type: 'string', Description: '', Order: 10 },
				{ id: 'p2', Name: 'b', Type: 'string', Description: '', Order: 20 },
			],
			{ parameters: declares({ name: 'b' }, { name: 'a' }) },
		);

		await createTool.call(ctx);

		const writes = ctx.calls.filter(
			(call) => call.method === 'PATCH' && call.url.startsWith('/v1/SystemAIToolParameter/'),
		);
		expect(writes.map((call) => [call.url, (call.body as IDataObject).Order])).toEqual([
			['/v1/SystemAIToolParameter/p2', 10],
			['/v1/SystemAIToolParameter/p1', 20],
		]);
	});

	it('deletes a row for a parameter the node no longer declares', async () => {
		const ctx = ctxFor(
			[
				{ id: 'p1', Name: 'ticketId', Type: 'string', Description: '', Order: 10 },
				{ id: 'p2', Name: 'dropped', Type: 'string', Description: '', Order: 20 },
			],
			{ parameters: declares({ name: 'ticketId' }) },
		);

		await createTool.call(ctx);

		const writes = ctx.calls.filter((call) => call.url.startsWith('/v1/SystemAIToolParameter/'));
		expect(writes).toEqual([
			expect.objectContaining({ method: 'DELETE', url: '/v1/SystemAIToolParameter/p2' }),
		]);
	});

	it('deletes every row when the node declares no parameters', async () => {
		const ctx = ctxFor([
			{ id: 'p1', Name: 'a', Type: 'string', Description: '', Order: 10 },
			{ id: 'p2', Name: 'b', Type: 'string', Description: '', Order: 20 },
		]);

		await createTool.call(ctx);

		expect(
			ctx.calls.filter((call) => call.method === 'DELETE').map((call) => call.url),
		).toEqual(['/v1/SystemAIToolParameter/p1', '/v1/SystemAIToolParameter/p2']);
	});

	// The API answers a query that matched nothing with a 404 rather than an empty
	// list, and a tool whose parameters were never written matches nothing — so
	// every first registration sees one.
	it('reads a 404 from the row lookup as "no rows yet" and creates them', async () => {
		const ctx = makeHookCtx({
			responses: [ok([TOOL]), ok(TOOL), notFound, ok({ id: 'p1' })],
			params: { parameters: declares({ name: 'ticketId' }) },
		});

		await expect(createTool.call(ctx)).resolves.toBe(true);
		expect(ctx.calls[3]).toMatchObject({ method: 'POST', url: '/v1/SystemAIToolParameter' });
	});

	// A 404 on the lookup is indistinguishable from a table that is not there, so
	// the first write is where the two are told apart.
	it('names the parameter table when the first write 404s', async () => {
		const ctx = makeHookCtx({
			responses: [ok([TOOL]), ok(TOOL), notFound, notFound],
			params: { parameters: declares({ name: 'ticketId' }) },
		});

		await expect(createTool.call(ctx)).rejects.toThrow(
			'Could not write to "SystemAIToolParameter" on this Servicely instance',
		);
	});

	// A row the lookup just returned proves the table is writable, so a 404 on it
	// is that row going away — no reason to fail the activation over it.
	it('carries on when a row vanished between the lookup and the delete', async () => {
		const ctx = makeHookCtx({
			responses: [
				ok([TOOL]),
				ok(TOOL),
				ok([{ id: 'p1', Name: 'dropped', Type: 'string', Order: 10 }]),
				// The IsLiveRun row is written before anything stale is removed
				ok({ id: 'p2' }),
				notFound,
			],
		});

		await expect(createTool.call(ctx)).resolves.toBe(true);
		expect(ctx.calls[4]).toMatchObject({ method: 'DELETE', url: '/v1/SystemAIToolParameter/p1' });
		expect(ctx.warnings.join()).toContain('no longer there');
	});

	it('ignores a stored row with no usable name', async () => {
		const ctx = ctxFor([{ id: 'p1', Name: '   ', Type: 'string', Order: 10 }]);

		await createTool.call(ctx);

		expect(ctx.calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
	});

	it('defaults an undeclared type to string and an absent description to empty', async () => {
		const ctx = ctxFor([], { parameters: declares({ name: 'ticketId' }) });

		await createTool.call(ctx);

		expect(ctx.calls[3].body).toEqual({
			Name: 'ticketId',
			Type: 'string',
			Description: '',
			Order: 10,
			Parent: 'tool-9',
		});
	});

	it('refuses a parameter the webhook would also refuse', async () => {
		const ctx = ctxFor([], { parameters: declares({ name: 'a' }, { name: 'a' }) });

		await expect(createTool.call(ctx)).rejects.toThrow(
			'The parameter "a" is defined more than once',
		);
	});
});

/**
 * The link between a tool and an agent lives on the agent: its `Tools` array
 * either holds the tool's id or does not. The selection drives both directions.
 */
describe('agent links', () => {
	/** An agent record, with whatever its Tools field happens to hold. */
	const agent = (id: string, tools?: unknown): IDataObject => ({
		id,
		Name: `Agent ${id}`,
		...(tools === undefined ? {} : { Tools: tools }),
	});

	/** The tool already exists, so create patches it, then reconciles the links. */
	function ctxFor(agents: IDataObject[], selected?: string[]) {
		return makeHookCtx({
			responses: [ok([TOOL]), ok(TOOL), ok([])],
			agents,
			params: selected === undefined ? {} : { options: { aiAgents: selected } },
		});
	}

	/** The Tools each agent was written back with, by agent id. */
	const written = (ctx: ReturnType<typeof makeHookCtx>) =>
		ctx.agentCalls
			.filter((call) => call.method === 'PATCH')
			.map((call) => [call.url, (call.body as IDataObject).Tools]);

	it('adds the tool to the selected agents, keeping what they already hold', async () => {
		const ctx = ctxFor([agent('a-1', ['other-tool']), agent('a-2', [])], ['a-1', 'a-2']);

		await createTool.call(ctx);

		expect(written(ctx)).toEqual([
			['/v1/SystemAIAgent/a-1', ['other-tool', 'tool-9']],
			['/v1/SystemAIAgent/a-2', ['tool-9']],
		]);
	});

	it('reads the registry whole, once, not one query per record', async () => {
		const ctx = ctxFor([agent('a-1', [])], ['a-1']);

		await createTool.call(ctx);

		// And only the registry the node selected in: the assistants were not asked for
		expect(ctx.agentCalls.filter((call) => call.method === 'GET').map((call) => call.url)).toEqual([
			'/v1/SystemAIAgent',
		]);
	});

	// A workflow that says nothing about a registry is not asking for its tool to be
	// taken out of it, so nothing is read and nothing is written.
	it('leaves a registry alone when its option was never added', async () => {
		const ctx = makeHookCtx({
			responses: [ok([TOOL]), ok(TOOL), ok([])],
			agents: [agent('a-1', ['tool-9'])],
			assistants: [agent('s-1', ['tool-9'])],
		});

		await createTool.call(ctx);

		expect(ctx.agentCalls).toEqual([]);
	});

	// Added and then emptied is a selection: it says "none of them".
	it('unlinks everything when the option is there but empty', async () => {
		const ctx = ctxFor([agent('a-1', ['tool-9'])], []);

		await createTool.call(ctx);

		expect(written(ctx)).toEqual([['/v1/SystemAIAgent/a-1', []]]);
	});

	it('writes nothing for an agent that already holds the tool', async () => {
		const ctx = ctxFor([agent('a-1', ['tool-9'])], ['a-1']);

		await createTool.call(ctx);

		expect(written(ctx)).toEqual([]);
	});

	it('takes the tool out of an agent that is no longer selected', async () => {
		const ctx = ctxFor([agent('a-1', ['tool-9', 'other-tool'])], []);

		await createTool.call(ctx);

		expect(written(ctx)).toEqual([['/v1/SystemAIAgent/a-1', ['other-tool']]]);
	});

	it('links and unlinks in the same pass', async () => {
		const ctx = ctxFor([agent('a-1', []), agent('a-2', ['tool-9'])], ['a-1']);

		await createTool.call(ctx);

		expect(written(ctx)).toEqual(
			expect.arrayContaining([
				['/v1/SystemAIAgent/a-1', ['tool-9']],
				['/v1/SystemAIAgent/a-2', []],
			]),
		);
	});

	it('leaves an unselected agent that never held the tool untouched', async () => {
		const ctx = ctxFor([agent('a-1', ['other-tool']), agent('a-2')], []);

		await createTool.call(ctx);

		expect(written(ctx)).toEqual([]);
	});

	// What an instance puts in the array varies, and the comparison has to be the
	// same either way.
	it('reads Tools entries that are references rather than bare ids', async () => {
		const ctx = ctxFor([agent('a-1', [{ id: 'tool-9' }, { id: 'other-tool' }])], []);

		await createTool.call(ctx);

		expect(written(ctx)).toEqual([['/v1/SystemAIAgent/a-1', ['other-tool']]]);
	});

	it('reads a Tools field that arrives as a serialised list', async () => {
		const ctx = ctxFor([agent('a-1', 'other-tool, tool-9')], []);

		await createTool.call(ctx);

		expect(written(ctx)).toEqual([['/v1/SystemAIAgent/a-1', ['other-tool']]]);
	});

	// A row the list just returned proves the table is writable, so a 404 on it is
	// that agent going away — no reason to fail the activation over it.
	it('carries on when an agent vanished between the read and the write', async () => {
		const ctx = makeHookCtx({
			responses: [ok([TOOL]), ok(TOOL), ok([])],
			agents: [agent('a-1', [])],
			agentWriteStatus: 404,
			params: { options: { aiAgents: ['a-1'] } },
		});

		await expect(createTool.call(ctx)).resolves.toBe(true);
		expect(ctx.warnings.join()).toContain('a-1 is no longer there');
	});

	it('reads an agent table that is not there as "no agents"', async () => {
		const ctx = makeHookCtx({
			responses: [ok([TOOL]), ok(TOOL), ok([])],
			agentListStatus: 404,
			params: { options: { aiAgents: ['a-1'] } },
		});

		await expect(createTool.call(ctx)).resolves.toBe(true);
		expect(ctx.agentCalls.filter((call) => call.method === 'PATCH')).toEqual([]);
	});

	it('still writes the parameters when the agent links fail', async () => {
		const ctx = makeHookCtx({
			responses: [ok([TOOL]), ok(TOOL), ok([])],
			agentListStatus: 401,
			params: {
				options: { aiAgents: ['a-1'] },
				parameters: declares({ name: 'ticketId' }),
			},
		});

		await expect(createTool.call(ctx)).rejects.toThrow('Authentication failed');
		expect(ctx.calls[3]).toMatchObject({ method: 'POST', url: '/v1/SystemAIToolParameter' });
	});

	it('strips the tool from every holder before the record is deleted', async () => {
		const ctx = makeHookCtx({
			responses: [ok([TOOL]), ok({})],
			agents: [agent('a-1', ['tool-9'])],
			assistants: [agent('s-1', ['tool-9', 'other-tool'])],
		});

		await expect(deleteTool.call(ctx)).resolves.toBe(true);
		expect(written(ctx)).toEqual(
			expect.arrayContaining([
				['/v1/SystemAIAgent/a-1', []],
				['/v1/SystemAIAssistant/s-1', ['other-tool']],
			]),
		);
		// Both writes land before the tool record goes
		const deleted = ctx.sequence.indexOf('DELETE /v1/SystemAITool/tool-9');
		expect(deleted).toBeGreaterThan(ctx.sequence.indexOf('PATCH /v1/SystemAIAgent/a-1'));
		expect(deleted).toBeGreaterThan(ctx.sequence.indexOf('PATCH /v1/SystemAIAssistant/s-1'));
		expect(ctx.sequence.indexOf('PATCH /v1/SystemAIAssistant/s-1')).toBeGreaterThan(-1);
	});

	// The assistant registry is the same mechanism against another table, driven by
	// its own selection.
	it('links and unlinks assistants from their own selection', async () => {
		const ctx = makeHookCtx({
			responses: [ok([TOOL]), ok(TOOL), ok([])],
			agents: [agent('a-1', [])],
			assistants: [agent('s-1', ['other-tool']), agent('s-2', ['tool-9'])],
			params: { options: { aiAgents: ['a-1'], aiAssistants: ['s-1'] } },
		});

		await createTool.call(ctx);

		expect(written(ctx)).toEqual(
			expect.arrayContaining([
				['/v1/SystemAIAgent/a-1', ['tool-9']],
				['/v1/SystemAIAssistant/s-1', ['other-tool', 'tool-9']],
				['/v1/SystemAIAssistant/s-2', []],
			]),
		);
	});

	it('leaves the assistants alone when only agents are selected', async () => {
		const ctx = makeHookCtx({
			responses: [ok([TOOL]), ok(TOOL), ok([])],
			agents: [agent('a-1', [])],
			assistants: [agent('s-1', ['other-tool'])],
			params: { options: { aiAgents: ['a-1'] } },
		});

		await createTool.call(ctx);

		expect(written(ctx)).toEqual([['/v1/SystemAIAgent/a-1', ['tool-9']]]);
		expect(ctx.agentCalls.map((call) => call.url)).not.toContain('/v1/SystemAIAssistant');
	});

	// An instance too old to have the table reads the same as one with no records.
	it('carries on when the assistant table is not there', async () => {
		const ctx = makeHookCtx({
			responses: [ok([TOOL]), ok(TOOL), ok([])],
			agentListStatus: 404,
			params: { options: { aiAssistants: ['s-1'] } },
		});

		await expect(createTool.call(ctx)).resolves.toBe(true);
		expect(ctx.agentCalls.filter((call) => call.method === 'PATCH')).toEqual([]);
	});

	it('deletes the tool even when the agents cannot be unlinked', async () => {
		const ctx = makeHookCtx({ responses: [ok([TOOL]), ok({})], agentListStatus: 401 });

		await expect(deleteTool.call(ctx)).resolves.toBe(true);
		expect(ctx.calls[1]).toMatchObject({ method: 'DELETE' });
		expect(ctx.warnings.join()).toContain('Could not unlink');
	});
});

describe('delete', () => {
	it('finds the tool by Key first, then deletes it by its record id', async () => {
		const ctx = makeHookCtx({ responses: [ok([TOOL]), ok({})] });

		await expect(deleteTool.call(ctx)).resolves.toBe(true);
		expect(ctx.calls[0].qs).toEqual({
			query: JSON.stringify({ and: [{ fieldName: 'Key', operator: '=', value: 'node-7' }] }),
			page: 1,
			page_size: 1,
		});
		expect(ctx.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
			'GET /v1/SystemAITool',
			'DELETE /v1/SystemAITool/tool-9',
		]);
	});

	it('deletes nothing when the Key matches no tool', async () => {
		const ctx = makeHookCtx({ responses: [ok([])] });

		await expect(deleteTool.call(ctx)).resolves.toBe(true);
		expect(ctx.calls).toHaveLength(1);
		expect(ctx.warnings[0]).toContain('No Servicely AI Agent Tool is registered');
	});

	// n8n clears a workflow's webhooks on the way into activation too, so a throw
	// here would block activating the workflow, not only deactivating it.
	it('does not fail deactivation when the record vanished between the two calls', async () => {
		const ctx = makeHookCtx({ responses: [ok([TOOL]), notFound] });

		await expect(deleteTool.call(ctx)).resolves.toBe(true);
		expect(ctx.calls[1].method).toBe('DELETE');
		expect(ctx.warnings[0]).toContain('Nothing to remove');
	});

	it('logs a real failure instead of failing the deactivation silently', async () => {
		const ctx = makeHookCtx({ responses: [ok([TOOL]), { status: 401, body: {} }] });

		await expect(deleteTool.call(ctx)).resolves.toBe(true);
		expect(ctx.errors.join()).toContain('Could not remove the Servicely AI Agent Tool');
		expect(ctx.errors.join()).toContain('Authentication failed');
	});

	it('does not fail deactivation for a node with no id', async () => {
		const ctx = makeHookCtx({ node: { id: undefined } });

		await expect(deleteTool.call(ctx)).resolves.toBe(true);
		expect(ctx.calls).toHaveLength(0);
	});
});

/**
 * "Listen for test event" registers the tool like an activation does, so the tool
 * can be exercised from the service desk while the workflow is being built. What it
 * must not do is *remove* a registration on stop — n8n creates a test webhook with
 * mode 'manual' but tears it down with ('internal', 'update'), the same pair a
 * production deactivation uses, so the teardown is recognised by its test URL.
 */
describe('test runs', () => {
	const TEST_URL = 'https://n8n.example.com/webhook-test/create-incident';

	it('reports the tool as missing so create runs and upserts it', async () => {
		const ctx = makeHookCtx({ mode: 'manual' });

		await expect(checkToolExists.call(ctx)).resolves.toBe(false);
		expect(ctx.calls).toHaveLength(0);
	});

	it('brings an existing registration up to date', async () => {
		const ctx = makeHookCtx({ mode: 'manual', responses: [ok([TOOL]), ok({})] });

		await expect(createTool.call(ctx)).resolves.toBe(true);
		expect(ctx.calls[1].method).toBe('PATCH');
	});

	it('leaves the registration alone when the listen is stopped', async () => {
		// What n8n passes when tearing a test webhook down
		const ctx = makeHookCtx({ mode: 'internal', webhookUrl: TEST_URL });

		await expect(deleteTool.call(ctx)).resolves.toBe(true);
		expect(ctx.calls).toHaveLength(0);
	});

	it('still deregisters on a real deactivation', async () => {
		const ctx = makeHookCtx({ mode: 'internal', responses: [ok([TOOL]), ok({})] });

		await expect(deleteTool.call(ctx)).resolves.toBe(true);
		expect(ctx.calls.map((call) => call.method)).toEqual(['GET', 'DELETE']);
	});

	// A node whose path is an unresolvable expression has no URL to inspect. Treating
	// that as production is the safe reading: the hooks behave as they always did.
	it('treats an unknown webhook URL as a production run', async () => {
		const ctx = makeHookCtx({
			mode: 'internal',
			webhookUrl: undefined,
			responses: [ok([TOOL]), ok({})],
		});

		await expect(deleteTool.call(ctx)).resolves.toBe(true);
		expect(ctx.calls.map((call) => call.method)).toEqual(['GET', 'DELETE']);
	});
});

describe('a second AI Tool node in the same workflow', () => {
	// The Key is the node's, so each node registers its own tool: the second one
	// finds nothing under its own id and creates a record of its own.
	it('registers a tool of its own rather than finding the first node’s', async () => {
		const ctx = makeHookCtx({
			responses: [ok([]), ok({ id: 'tool-10' })],
			node: { id: 'node-8', name: 'Close Incident' },
		});

		await expect(checkToolExists.call(ctx)).resolves.toBe(false);
		expect(ctx.calls[0].qs).toMatchObject({
			query: JSON.stringify({ and: [{ fieldName: 'Key', operator: '=', value: 'node-8' }] }),
		});

		await createTool.call(ctx);
		expect(ctx.calls[2].body).toMatchObject({ Key: 'node-8', Name: '[n8n] Close Incident' });
	});
});
