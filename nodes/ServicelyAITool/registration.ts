import { IDataObject, type IHookFunctions, NodeApiError, NodeOperationError } from 'n8n-workflow';

import {
	parseList,
	servicelyApiRequest,
	servicelyApiRequestAllItems,
	toRecordList,
} from '../Servicely/GenericFunctions';
import type { ServicelyRecord } from '../Servicely/types';
import {
	DEFAULT_RESPONSE_TIMEOUT_SECONDS,
	readParameterDefinitions,
	readResponseTimeoutSeconds,
} from './parameters';
import type { ParameterDefinition } from './validation';

/**
 * Registration of the workflow as a tool the Servicely service desk can select,
 * driven by n8n's webhook lifecycle: `checkExists` and `create` run when the
 * workflow is activated, `delete` when it is deactivated.
 *
 * The record is found by its `Key`, which holds the n8n workflow id — so a
 * workflow owns at most one tool record, and every hook resolves it the same way.
 * `create` upserts against that Key, which keeps activation idempotent: a second
 * AI Tool node in the same workflow, or a record left behind by a deactivation
 * that could not reach the instance, updates it instead of failing on it.
 */

/** Table holding the tools an AI agent can select. */
const TOOL_TABLE = 'SystemAITool';

/** Field the n8n workflow id is stored under, and how a tool is found again. */
const TOOL_KEY_FIELD = 'Key';

/** Table holding one row per argument of a tool. */
const PARAMETER_TABLE = 'SystemAIToolParameter';

/** `SystemAIToolParam` reference back to the tool the row belongs to. */
const PARAMETER_PARENT_FIELD = 'Parent';

/** Order of the first parameter, and the step between them, leaving room to insert. */
const PARAMETER_ORDER_START = 10;
const PARAMETER_ORDER_STEP = 10;

/** A tool has a handful of parameters, so one page is always the whole set. */
const PARAMETER_PAGE_SIZE = 200;

/** Table holding the AI agents a tool can be exported to. */
const AGENT_TABLE = 'SystemAIAgent';

/** The agent field listing the tools that agent may call. */
const AGENT_TOOLS_FIELD = 'Tools';

/** Marks a tool record as maintained by n8n rather than edited in the service desk. */
const NAME_PREFIX = '[n8n]';

/** The node's single webhook, as declared in its description. */
const WEBHOOK_NAME = 'default';

/** Path segment n8n serves a node's test webhook under, as opposed to `/webhook/`. */
const TEST_URL_SEGMENT = '/webhook-test/';

/**
 * Whether this is a "Listen for test event" run rather than a production
 * activation. A test run must leave the service desk untouched: it neither
 * registers a tool nor — the case that actually bites — removes the registration
 * of a workflow that is active at the same time.
 *
 * `getMode()` cannot answer it on its own. n8n creates a test webhook with mode
 * 'manual', but tears it down with ('internal', 'update'), which is the very pair
 * a production deactivation uses. The webhook URL is built from the same internal
 * `isTest` flag, so it is the one signal every hook can read.
 */
function isTestRegistration(ctx: IHookFunctions): boolean {
	if (ctx.getMode() === 'manual') {
		return true;
	}
	return ctx.getNodeWebhookUrl(WEBHOOK_NAME)?.includes(TEST_URL_SEGMENT) ?? false;
}

/** The workflow id, which is the tool's Key. Absent only for a workflow never saved. */
function toolKey(ctx: IHookFunctions): string {
	const { id } = ctx.getWorkflow();
	if (!id) {
		throw new NodeOperationError(ctx.getNode(), 'The workflow has no id yet', {
			description: 'Save the workflow before activating it, so the tool can be registered.',
		});
	}
	return String(id);
}

/** Whether a request failed with 404. */
function isNotFound(error: IDataObject): boolean {
	if (error.message && typeof error.message === 'string') {
		return error.message.includes('Record not found');
	}
	return error instanceof NodeApiError && error.statusCode === 404;
}

/**
 * A 404 on a *write* is not a missing row: a create has none to miss, and an
 * update was handed an id the lookup just resolved. What is left is the table
 * itself, so name it — the generic "Record not found. Check the table name and
 * Record ID." sends the reader hunting for an id that was never the problem, and
 * the registration touches two tables: the tool and its parameters.
 *
 * A 404 on a *read* means nothing of the sort. This API answers a query that
 * matched nothing with 404 rather than an empty list, so there a 404 is simply
 * "no such record" and the callers treat it as one.
 */
function missingTableError(ctx: IHookFunctions, table: string): NodeOperationError {
	const isTool = table === TOOL_TABLE;
	return new NodeOperationError(
		ctx.getNode(),
		`Could not write to "${table}" on this Servicely instance`,
		{
			description: isTool
				? `POST /v1/${table} answered 404, so the instance has no such table. Confirm the table it keeps AI tools in and set TOOL_TABLE in nodes/ServicelyAITool/registration.ts to match.`
				: `The tool itself registered, but writing its parameters to /v1/${table} answered 404. Either the instance keeps an AI tool's arguments in a differently-named table (PARAMETER_TABLE in nodes/ServicelyAITool/registration.ts) or it did not accept "${PARAMETER_PARENT_FIELD}" as the reference back to the tool (PARAMETER_PARENT_FIELD).`,
		},
	);
}

/**
 * The tool's `TimeoutSeconds`. The node's own value, unless an expression left it
 * unusable — the field has to be a number, and the node's default is the honest
 * answer for how long it waits then.
 */
function timeoutSeconds(ctx: IHookFunctions): number {
	const seconds = readResponseTimeoutSeconds(ctx);
	return Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_RESPONSE_TIMEOUT_SECONDS;
}

/** The tool record carrying this workflow's Key, if the instance already has one. */
async function findTool(ctx: IHookFunctions, key: string): Promise<ServicelyRecord | undefined> {
	let payload: unknown;
	try {
		ctx.logger.debug(`Looking for a ${TOOL_TABLE} record with ${TOOL_KEY_FIELD}=${key}`);
		payload = await servicelyApiRequest.call(ctx, 'GET', `/v1/${TOOL_TABLE}`, undefined, {
			query: JSON.stringify({
				and: [{ fieldName: TOOL_KEY_FIELD, operator: '=', value: key }],
			}),
			page: 1,
			page_size: 1,
		});
	} catch (error) {
		if (isNotFound(error as IDataObject)) {
			return undefined;
		}
		throw error;
	}
	return toRecordList<ServicelyRecord>(payload)[0];
}

/**
 * Whether the instance already knows this workflow as a tool. A `true` tells n8n
 * to skip `create`. The Key is the only identity the hooks rely on, so nothing has
 * to be remembered between them — a restart or a lost workflow cache changes
 * nothing about what this answers.
 */
export async function checkToolExists(this: IHookFunctions): Promise<boolean> {
	// A `true` is what stops n8n from calling `create`, so it is also how a test
	// run declines to register anything.
	if (isTestRegistration(this)) {
		return false;
	}
	return (await findTool(this, toolKey(this))) !== undefined;
}

/** The id of a record the API just wrote back, whether it echoed one object or a list. */
function recordId(payload: unknown): string | undefined {
	const record = (Array.isArray(payload) ? payload[0] : payload) as ServicelyRecord | undefined;
	const id = record?.id;
	return id === undefined || id === null ? undefined : String(id);
}

/**
 * The parameter rows the instance currently holds for a tool, or none.
 *
 * A 404 is "none": this API answers a query that matched nothing with 404 rather
 * than an empty list, and a tool whose parameters were never written — every
 * first registration — matches nothing. That reads the same as a parameter table
 * which is not there at all, so the two are told apart on the first write
 * instead, where a 404 has no other explanation (see `writeParameter`).
 */
async function listParameters(ctx: IHookFunctions, toolId: string): Promise<ServicelyRecord[]> {
	try {
		return toRecordList<ServicelyRecord>(
			await servicelyApiRequest.call(ctx, 'GET', `/v1/${PARAMETER_TABLE}`, undefined, {
				query: JSON.stringify({
					and: [{ fieldName: PARAMETER_PARENT_FIELD, operator: '=', value: toolId }],
				}),
				page: 1,
				page_size: PARAMETER_PAGE_SIZE,
			}),
		);
	} catch (error) {
		if (isNotFound(error as IDataObject)) {
			return [];
		}
		throw error;
	}
}

/**
 * One write against the parameter table, where a 404 means two different things
 * depending on the method.
 *
 * A POST addresses the table, not a row, so a 404 is the table refusing the write
 * under that name — {@link missingTableError} says so. A PATCH or DELETE
 * addresses a row the list just returned, which is proof the table is there and
 * writable, so a 404 can only be that row disappearing in between; the next
 * activation writes it again, and failing this one over it would leave the
 * workflow unable to activate at all.
 */
async function writeParameter(
	ctx: IHookFunctions,
	method: 'POST' | 'PATCH' | 'DELETE',
	path: string,
	body?: IDataObject,
): Promise<void> {
	try {
		await servicelyApiRequest.call(ctx, method, path, body);
	} catch (error) {
		if (!isNotFound(error as IDataObject)) {
			throw error;
		}
		if (method === 'POST') {
			throw missingTableError(ctx, PARAMETER_TABLE);
		}
		ctx.logger.warn(`The Servicely AI Tool parameter at ${path} is no longer there`);
	}
}

/** The row a declared parameter should have, at its position in the declared order. */
function parameterFields(definition: ParameterDefinition, order: number): IDataObject {
	return {
		Name: definition.key,
		Type: definition.type,
		Description: definition.description,
		Order: order,
	};
}

/** Whether a stored row already says what the declaration says. */
function parameterMatches(row: ServicelyRecord, fields: IDataObject): boolean {
	return (
		row.Type === fields.Type &&
		(row.Description ?? '') === fields.Description &&
		Number(row.Order) === fields.Order
	);
}

/**
 * Brings a tool's parameter rows in line with what the node declares, by name:
 * a declared parameter with no row is created, one whose type, description or
 * position moved is patched, and a row for a parameter the node no longer declares
 * is deleted. A row that already matches is left untouched, so re-activating a
 * workflow whose parameters did not change writes nothing.
 *
 * `Order` is assigned from the declared order rather than read from the rows, which
 * is what lets reordering the collection in n8n reorder the tool's arguments.
 */
async function syncParameters(
	ctx: IHookFunctions,
	toolId: string,
	definitions: ParameterDefinition[],
): Promise<void> {
	const stale = new Map<string, ServicelyRecord>();
	for (const row of await listParameters(ctx, toolId)) {
		const name = typeof row.Name === 'string' ? row.Name.trim() : '';
		if (name !== '') {
			stale.set(name, row);
		}
	}

	/* eslint-disable no-await-in-loop -- one row at a time: the writes are few and
	   ordering them keeps a partial failure easy to read in the log */
	let order = PARAMETER_ORDER_START;
	for (const definition of definitions) {
		const fields = parameterFields(definition, order);
		const row = stale.get(definition.key);
		stale.delete(definition.key);
		order += PARAMETER_ORDER_STEP;

		if (row === undefined) {
			await writeParameter(ctx, 'POST', `/v1/${PARAMETER_TABLE}`, {
				...fields,
				[PARAMETER_PARENT_FIELD]: toolId,
			});
		} else if (!parameterMatches(row, fields)) {
			await writeParameter(ctx, 'PATCH', `/v1/${PARAMETER_TABLE}/${String(row.id)}`, fields);
		}
	}

	// Whatever is left belongs to a parameter the node no longer declares.
	for (const row of stale.values()) {
		await writeParameter(ctx, 'DELETE', `/v1/${PARAMETER_TABLE}/${String(row.id)}`);
	}
	/* eslint-enable no-await-in-loop */
}

/**
 * Exporting the tool to agents. The link lives on the *agent*: a `SystemAIAgent`
 * carries a `Tools` array, so selecting agents on the node means adding the tool's
 * id to theirs, and deselecting one means taking it out again.
 *
 * The whole agent table is read once per registration and the two sides are worked
 * out from it. That is exact — it never has to guess how an instance serialises the
 * array to match on it — and it costs the one request that querying only the
 * selected agents would have cost anyway, while also answering the question the
 * selection cannot: which agents still hold a tool nobody selected any more.
 */

/** The agents the node exports this tool to, as record ids. */
function selectedAgentIds(ctx: IHookFunctions): string[] {
	return parseList(ctx.getNodeParameter('aiAgents', []));
}

/**
 * Every agent the instance has. A 404 is "none": the API answers a query that
 * matched nothing that way, and an instance with no agent table has none either.
 */
async function listAgents(ctx: IHookFunctions): Promise<ServicelyRecord[]> {
	try {
		return (await servicelyApiRequestAllItems.call(
			ctx,
			`/v1/${AGENT_TABLE}`,
		)) as ServicelyRecord[];
	} catch (error) {
		if (isNotFound(error as IDataObject)) {
			return [];
		}
		throw error;
	}
}

/**
 * The tool ids an agent's `Tools` field holds. The field is an array, but what an
 * instance puts in it varies — bare ids, or references carrying one — and a field
 * never written comes back absent. Everything is read as a string id, so the
 * comparison against the tool is the same in every case.
 */
function agentTools(agent: ServicelyRecord): string[] {
	const value = agent[AGENT_TOOLS_FIELD];
	if (!Array.isArray(value)) {
		// A single reference, or a serialised list — parseList reads all of those
		return parseList(value);
	}
	return value
		.map((entry) =>
			entry !== null && typeof entry === 'object'
				? String((entry as IDataObject).id ?? '')
				: String(entry ?? ''),
		)
		.map((entry) => entry.trim())
		.filter((entry) => entry !== '');
}

/**
 * Writes an agent's `Tools` back. A 404 is that agent going away between the read
 * and the write — the next activation links it again if it comes back, and failing
 * the activation over an agent that is gone would help nobody.
 */
async function writeAgentTools(
	ctx: IHookFunctions,
	agent: ServicelyRecord,
	tools: string[],
): Promise<void> {
	const id = String(agent.id);
	try {
		await servicelyApiRequest.call(ctx, 'PATCH', `/v1/${AGENT_TABLE}/${id}`, {
			[AGENT_TOOLS_FIELD]: tools,
		});
	} catch (error) {
		if (!isNotFound(error as IDataObject)) {
			throw error;
		}
		ctx.logger.warn(`The Servicely AI agent ${id} is no longer there`);
	}
}

/** Adds the tool to the agents that should have it. One PATCH per agent that gains it. */
async function linkAgents(
	ctx: IHookFunctions,
	toolId: string,
	agents: ServicelyRecord[],
): Promise<void> {
	/* eslint-disable no-await-in-loop -- one agent at a time, so a partial failure
	   reads in order in the log; the sets are small and the two tasks run in parallel */
	for (const agent of agents) {
		const tools = agentTools(agent);
		if (!tools.includes(toolId)) {
			await writeAgentTools(ctx, agent, [...tools, toolId]);
		}
	}
	/* eslint-enable no-await-in-loop */
}

/** Takes the tool out of the agents that should not have it, and only those. */
async function unlinkAgents(
	ctx: IHookFunctions,
	toolId: string,
	agents: ServicelyRecord[],
): Promise<void> {
	/* eslint-disable no-await-in-loop -- see linkAgents */
	for (const agent of agents) {
		const tools = agentTools(agent);
		if (tools.includes(toolId)) {
			await writeAgentTools(
				ctx,
				agent,
				tools.filter((id) => id !== toolId),
			);
		}
	}
	/* eslint-enable no-await-in-loop */
}

/**
 * Brings the agents' `Tools` in line with the node's selection: the selected
 * agents gain the tool, everyone else loses it. An agent already in the state it
 * should be in is not written, so re-activating an unchanged workflow patches
 * nothing.
 *
 * Linking and unlinking are two tasks over two disjoint sets of agents, so they
 * never write the same record and run at the same time. An empty selection is the
 * deregistration case: nothing to link, and the tool comes out of every agent.
 */
async function syncAgentLinks(
	ctx: IHookFunctions,
	toolId: string,
	selected: string[],
): Promise<void> {
	const wanted = new Set(selected);
	const chosen: ServicelyRecord[] = [];
	const rest: ServicelyRecord[] = [];

	for (const agent of await listAgents(ctx)) {
		(wanted.has(String(agent.id)) ? chosen : rest).push(agent);
	}

	await Promise.all([linkAgents(ctx, toolId, chosen), unlinkAgents(ctx, toolId, rest)]);
}

/**
 * Registers the workflow as an active tool, or brings an existing registration up
 * to date, then mirrors the node's declared parameters into the tool's parameter
 * rows. The record is looked up by its Key first, so this is an upsert: a second
 * run neither fails on a duplicate Key nor leaves a stale Prompt behind.
 *
 * The Key is only sent when creating. It is the record's identity, so an update
 * has no business rewriting it.
 */
export async function createTool(this: IHookFunctions): Promise<boolean> {
	this.logger.debug('Registering the Servicely AI Tool for this workflow');
	const key = toolKey(this);
	const workflowName = this.getWorkflow().name ?? key;

	const fields: IDataObject = {
		Name: `${NAME_PREFIX} ${workflowName}`,
		Active: true,
		SelectionPrompt: String(this.getNodeParameter('prompt', '') ?? ''),
		Description: `Created by the n8n workflow "${workflowName}"`,
		// Sent on every registration, so the caller's patience follows the node's:
		// a value the node cannot use is one the service desk should not be given.
		TimeoutSeconds: timeoutSeconds(this),
	};

	const existing = await findTool(this, key);
	let toolId: string | undefined;

	try {
		if (existing === undefined) {
			toolId = recordId(
				await servicelyApiRequest.call(this, 'POST', `/v1/${TOOL_TABLE}`, {
					[TOOL_KEY_FIELD]: key,
					...fields,
				}),
			);
			// Not every write echoes the record back, and the parameters need its id
			toolId ??= recordId(await findTool(this, key));
		} else {
			toolId = String(existing.id);
			await servicelyApiRequest.call(this, 'PATCH', `/v1/${TOOL_TABLE}/${toolId}`, fields);
		}
	} catch (error) {
		throw isNotFound(error as IDataObject) ? missingTableError(this, TOOL_TABLE) : error;
	}

	if (toolId === undefined) {
		throw new NodeOperationError(this.getNode(), 'The registered Servicely AI Tool has no id', {
			description: `The ${TOOL_TABLE} record could not be resolved after writing it, so the tool's parameters could not be created.`,
		});
	}

	// Two independent tasks against two different tables, so they run together.
	// `allSettled` and not `all`: whichever fails, the other still finishes rather
	// than being left half-written while the activation reports the first error.
	const definitions = readParameterDefinitions(this);
	const outcomes = await Promise.allSettled([
		syncParameters(this, toolId, definitions),
		syncAgentLinks(this, toolId, selectedAgentIds(this)),
	]);
	const failure = outcomes.find((outcome) => outcome.status === 'rejected');
	if (failure?.status === 'rejected') {
		throw failure.reason;
	}

	return true;
}

/**
 * Removes the tool when the workflow is deactivated, so the service desk stops
 * offering an endpoint that no longer answers. The record is looked up by its Key
 * first and only deleted if it is there.
 *
 * Nothing left to remove is not a failure: a record deleted in the service desk,
 * or a tool table that is not there at all, both mean the tool is gone. That
 * matters more than it looks, because n8n clears a workflow's webhooks on the way
 * *into* activation too — a throw here would block activating the workflow, not
 * just deactivating it. Anything else (an expired token, a 500) still propagates.
 */
export async function deleteTool(this: IHookFunctions): Promise<boolean> {
	// Stopping a test listen must not deregister a workflow that is active.
	if (isTestRegistration(this)) {
		this.logger.debug('Test run: leaving the Servicely AI Tool registration alone');
		return true;
	}

	try {
		this.logger.debug('Removing the Servicely AI Tool for this workflow');
		// Resolved by Key on every call, so the record is found however long the
		// workflow was active and whatever happened to it in the meantime.
		const existing = await findTool(this, toolKey(this));
		if (existing === undefined) {
			this.logger.warn('No Servicely AI Tool is registered for this workflow');
			return true;
		}

		// Unlink before deleting, so no agent is left pointing at a record that is
		// about to go. A failure here must not keep the tool registered, so the
		// delete goes ahead either way.
		try {
			await syncAgentLinks(this, String(existing.id), []);
		} catch (error) {
			const { message } = error as Error;
			this.logger.warn(`Could not unlink the Servicely AI Tool from its agents: ${message}`);
		}

		await servicelyApiRequest.call(this, 'DELETE', `/v1/${TOOL_TABLE}/${String(existing.id)}`);
	} catch (error) {
		// Nothing is rethrown, but a real failure still has to leave a trace —
		// otherwise a wrong token or a 500 removes nothing and says nothing.
		const { message } = error as Error;
		if (isNotFound(error as IDataObject) || error instanceof NodeOperationError) {
			this.logger.warn(`Nothing to remove for the Servicely AI Tool: ${message}`);
		} else {
			this.logger.error(`Could not remove the Servicely AI Tool: ${message}`);
		}
	}

	return true;
}

/** The `webhookMethods` block the AI Tool node attaches to its default webhook. */
export const toolRegistrationMethods = {
	default: {
		checkExists: checkToolExists,
		create: createTool,
		delete: deleteTool,
	},
};
