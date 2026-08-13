import { IDataObject, type IHookFunctions, NodeApiError, NodeOperationError } from 'n8n-workflow';

import {
	parseList,
	servicelyApiRequest,
	servicelyApiRequestAllItems,
	toRecordList,
} from '../Servicely/GenericFunctions';
import type { ServicelyRecord } from '../Servicely/types';
import { toolDescription, toolKey, toolName } from './identity';
import {
	DEFAULT_EXECUTION_SCRIPT,
	readParameterDefinitions,
	readToolTimeoutSeconds,
} from './parameters';
import type { ParameterDefinition } from './validation';

/**
 * Registration of the node as a tool the Servicely service desk can select,
 * driven by n8n's webhook lifecycle: `checkExists` and `create` run when the
 * workflow is activated, `delete` when it is deactivated.
 *
 * The record is found by its `Key`, which holds the n8n *node* id — so each AI
 * Tool node owns exactly one tool record, and a workflow that declares several
 * tools registers one per node. Every hook resolves it the same way. `create`
 * upserts against that Key, which keeps activation idempotent: a record left
 * behind by a deactivation that could not reach the instance is updated rather
 * than failed on.
 *
 * The node id is n8n's own and survives everything a workflow can do to a node
 * except deleting it — renaming it, moving it, editing its parameters — so a
 * tool keeps its registration, and its links to agents and assistants, across
 * all of those.
 */

/** Table holding the tools an AI agent can select. */
const TOOL_TABLE = 'SystemAITool';

/** Field the n8n node id is stored under, and how a tool is found again. */
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

/** The field listing the tools a holder may call, on both registries. */
const HOLDER_TOOLS_FIELD = 'Tools';

/**
 * What a tool can be exported to: an AI agent, or an AI assistant. The two behave
 * identically — a registry of records whose `Tools` array names the tools they may
 * call, selected on the node by record id — so they are described rather than
 * written out twice, and adding a third would be one more entry here.
 */
const TOOL_HOLDERS = [
	{ noun: 'agent', table: 'SystemAIAgent', option: 'aiAgents' },
	{ noun: 'assistant', table: 'SystemAIAssistant', option: 'aiAssistants' },
] as const;

type ToolHolder = (typeof TOOL_HOLDERS)[number];

/** Stands in for this tool's webhook URL inside the Execution Script. */
const URL_PLACEHOLDER = '@@URL@@';

/**
 * The placeholder as it appears in a script: already inside a pair of matching
 * quotes, or bare. The quoted form is matched first, so a script that quoted the
 * placeholder itself gets the URL put inside its quotes rather than a second pair
 * around them.
 */
const URL_PLACEHOLDER_PATTERN = /(['"`])@@URL@@\1|@@URL@@/g;

/** The node's single webhook, as declared in its description. */
const WEBHOOK_NAME = 'default';

/** Path segment n8n serves a node's test webhook under, as opposed to `/webhook/`. */
const TEST_URL_SEGMENT = '/webhook-test/';

/** The segment a production webhook is served under, and what a script is given. */
const PRODUCTION_URL_SEGMENT = '/webhook/';

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

/**
 * The Execution Script as the service desk should hold it: the option's script —
 * or {@link DEFAULT_EXECUTION_SCRIPT} when the node does not give one, since a tool
 * with no script would be registered and then do nothing — with every
 * {@link URL_PLACEHOLDER} replaced by this tool's webhook URL, so a script can name
 * its own endpoint without being edited per instance.
 *
 * Always the *production* URL, even when a test listen is what triggered the
 * registration: the script decides at call time which endpoint it wants (the
 * default one rewrites the segment when `IsProduction` is false), so handing it a
 * test URL would leave it deriving a test URL from a test URL.
 *
 * The URL is a string wherever it lands, so a bare placeholder is quoted on the
 * way in. One the script already quoted keeps the quotes it was written with —
 * quoting it again would only produce an empty string next to a bare URL.
 *
 * @throws {NodeOperationError} when the script asks for a URL n8n cannot resolve
 */
function executionScript(ctx: IHookFunctions): string {
	const { executionScript: configured } = ctx.getNodeParameter('options', {}) as {
		executionScript?: string;
	};
	// Blank counts as "not given": n8n drops an option left at its default when the
	// workflow is saved, so the default has to be the fallback rather than only the box
	const written = String(configured ?? '');
	const script = written.trim() === '' ? DEFAULT_EXECUTION_SCRIPT : written;
	if (!script.includes(URL_PLACEHOLDER)) {
		return script;
	}

	const url = ctx.getNodeWebhookUrl(WEBHOOK_NAME);
	if (!url) {
		throw new NodeOperationError(
			ctx.getNode(),
			`The Execution Script uses ${URL_PLACEHOLDER}, but this tool's webhook URL could not be resolved`,
			{ description: 'Give the node a fixed Path, save the workflow, and activate it again.' },
		);
	}

	const productionUrl = url.replace(TEST_URL_SEGMENT, PRODUCTION_URL_SEGMENT);

	return script.replace(URL_PLACEHOLDER_PATTERN, (match) => {
		const quote = match === URL_PLACEHOLDER ? "'" : match[0];
		return `${quote}${productionUrl}${quote}`;
	});
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

/** The tool record carrying this node's Key, if the instance already has one. */
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
 * Whether the instance already knows this node as a tool. A `true` tells n8n to
 * skip `create`. The Key is the only identity the hooks rely on, so nothing has
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
		ctx.logger.warn(`The Servicely AI Agent Tool parameter at ${path} is no longer there`);
	}
}

/**
 * The row a declared parameter should have, at its position in the declared order.
 *
 * A definition's `required` is deliberately not among the fields: it says what this
 * node's webhook rejects, and the parameter table is not asked to carry a flag it
 * may not have a column for. Every declared parameter is mirrored either way.
 */
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
 * Exporting the tool to its holders. The link lives on the *holder*: a
 * `SystemAIAgent` or `SystemAIAssistant` carries a `Tools` array, so selecting one
 * on the node means adding the tool's id to theirs, and deselecting it means taking
 * it out again.
 *
 * Each registry is read once per registration and both sides are worked out from
 * it. That is exact — it never has to guess how an instance serialises the array to
 * match on it — and it costs the one request that querying only the selected records
 * would have cost anyway, while also answering the question the selection cannot:
 * which holders still hold a tool nobody selected any more.
 */

/**
 * The records of one registry the node exports this tool to, as ids, or
 * `undefined` when the option was never added — which is not the same as an empty
 * selection. A workflow that says nothing about assistants is not asking for its
 * tool to be taken out of them, and the reconciliation is skipped entirely rather
 * than reading a table to conclude there is nothing to do.
 */
function selectedIds(ctx: IHookFunctions, holder: ToolHolder): string[] | undefined {
	const options = ctx.getNodeParameter('options', {}) as Record<string, unknown>;
	const selection = options[holder.option];
	return selection === undefined ? undefined : parseList(selection);
}

/**
 * Every record one registry has. A 404 is "none": the API answers a query that
 * matched nothing that way, and an instance without the table has none either —
 * which is also how an instance too old to know about assistants reads.
 */
async function listHolders(ctx: IHookFunctions, holder: ToolHolder): Promise<ServicelyRecord[]> {
	try {
		return (await servicelyApiRequestAllItems.call(
			ctx,
			`/v1/${holder.table}`,
		)) as ServicelyRecord[];
	} catch (error) {
		if (isNotFound(error as IDataObject)) {
			return [];
		}
		throw error;
	}
}

/**
 * The tool ids a holder's `Tools` field holds. The field is an array, but what an
 * instance puts in it varies — bare ids, or references carrying one — and a field
 * never written comes back absent. Everything is read as a string id, so the
 * comparison against the tool is the same in every case.
 */
function holderTools(record: ServicelyRecord): string[] {
	const value = record[HOLDER_TOOLS_FIELD];
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
 * Writes a holder's `Tools` back. A 404 is that record going away between the read
 * and the write — the next activation links it again if it comes back, and failing
 * the activation over a record that is gone would help nobody.
 */
async function writeHolderTools(
	ctx: IHookFunctions,
	holder: ToolHolder,
	record: ServicelyRecord,
	tools: string[],
): Promise<void> {
	const id = String(record.id);
	try {
		await servicelyApiRequest.call(ctx, 'PATCH', `/v1/${holder.table}/${id}`, {
			[HOLDER_TOOLS_FIELD]: tools,
		});
	} catch (error) {
		if (!isNotFound(error as IDataObject)) {
			throw error;
		}
		ctx.logger.warn(`The Servicely AI ${holder.noun} ${id} is no longer there`);
	}
}

/** Adds the tool to the records that should have it. One PATCH per record that gains it. */
async function link(
	ctx: IHookFunctions,
	holder: ToolHolder,
	toolId: string,
	records: ServicelyRecord[],
): Promise<void> {
	/* eslint-disable no-await-in-loop -- one record at a time, so a partial failure
	   reads in order in the log; the sets are small and the two tasks run in parallel */
	for (const record of records) {
		const tools = holderTools(record);
		if (!tools.includes(toolId)) {
			await writeHolderTools(ctx, holder, record, [...tools, toolId]);
		}
	}
	/* eslint-enable no-await-in-loop */
}

/** Takes the tool out of the records that should not have it, and only those. */
async function unlink(
	ctx: IHookFunctions,
	holder: ToolHolder,
	toolId: string,
	records: ServicelyRecord[],
): Promise<void> {
	/* eslint-disable no-await-in-loop -- see link */
	for (const record of records) {
		const tools = holderTools(record);
		if (tools.includes(toolId)) {
			await writeHolderTools(
				ctx,
				holder,
				record,
				tools.filter((id) => id !== toolId),
			);
		}
	}
	/* eslint-enable no-await-in-loop */
}

/**
 * Brings one registry's `Tools` in line with the node's selection for it: the
 * selected records gain the tool, everyone else loses it. A record already in the
 * state it should be in is not written, so re-activating an unchanged workflow
 * patches nothing.
 *
 * Linking and unlinking are two tasks over two disjoint sets of records, so they
 * never write the same one and run at the same time. An empty selection is the
 * deregistration case: nothing to link, and the tool comes out of every record.
 */
async function syncHolderLinks(
	ctx: IHookFunctions,
	holder: ToolHolder,
	toolId: string,
	selected: string[],
): Promise<void> {
	const wanted = new Set(selected);
	const chosen: ServicelyRecord[] = [];
	const rest: ServicelyRecord[] = [];

	for (const record of await listHolders(ctx, holder)) {
		(wanted.has(String(record.id)) ? chosen : rest).push(record);
	}

	await Promise.all([link(ctx, holder, toolId, chosen), unlink(ctx, holder, toolId, rest)]);
}

/**
 * Every registry the node has something to say about, reconciled against what it
 * selects there, all at once. A registry `selection` answers `undefined` for is
 * left alone — no read, no writes.
 */
function syncAllHolderLinks(
	ctx: IHookFunctions,
	toolId: string,
	selection: (holder: ToolHolder) => string[] | undefined,
): Array<Promise<void>> {
	return TOOL_HOLDERS.flatMap((holder) => {
		const selected = selection(holder);
		return selected === undefined ? [] : [syncHolderLinks(ctx, holder, toolId, selected)];
	});
}

/**
 * Registers this node as an active tool, or brings an existing registration up
 * to date, then mirrors the node's declared parameters into the tool's parameter
 * rows. The record is looked up by its Key first, so this is an upsert: a second
 * run neither fails on a duplicate Key nor leaves a stale Prompt behind.
 *
 * The Key is only sent when creating. It is the record's identity, so an update
 * has no business rewriting it.
 */
export async function createTool(this: IHookFunctions): Promise<boolean> {
	this.logger.debug('Registering the Servicely AI Agent Tool for this node');
	const key = toolKey(this);

	const fields: IDataObject = {
		// Always sent, so renaming the node renames the tool on the next activation
		Name: toolName(this),
		Active: true,
		SelectionPrompt: String(this.getNodeParameter('prompt', '') ?? ''),
		Description: toolDescription(this),
		// Always sent, so clearing the field in n8n clears it on the record too
		ExecutionScript: executionScript(this),
		// How long the service desk waits for a call to be answered — the node's Tool
		// Timeout. n8n sets no deadline of its own, so this is the only one there is,
		// and it is sent on every registration so a changed timeout takes effect.
		TimeoutSeconds: readToolTimeoutSeconds(this),
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
		throw new NodeOperationError(this.getNode(), 'The registered Servicely AI Agent Tool has no id', {
			description: `The ${TOOL_TABLE} record could not be resolved after writing it, so the tool's parameters could not be created.`,
		});
	}

	// Independent tasks against separate tables, so they run together. `allSettled`
	// and not `all`: whichever fails, the others still finish rather than being left
	// half-written while the activation reports the first error.
	const definitions = readParameterDefinitions(this);
	const outcomes = await Promise.allSettled([
		syncParameters(this, toolId, definitions),
		...syncAllHolderLinks(this, toolId, (holder) => selectedIds(this, holder)),
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
		this.logger.debug('Test run: leaving the Servicely AI Agent Tool registration alone');
		return true;
	}

	try {
		this.logger.debug('Removing the Servicely AI Agent Tool for this node');
		// Resolved by Key on every call, so the record is found however long the
		// workflow was active and whatever happened to it in the meantime.
		const existing = await findTool(this, toolKey(this));
		if (existing === undefined) {
			this.logger.warn('No Servicely AI Agent Tool is registered for this node');
			return true;
		}

		// Unlink before deleting, so no agent or assistant is left pointing at a record
		// that is about to go. A failure here must not keep the tool registered, so
		// the delete goes ahead either way.
		try {
			// An empty selection everywhere: the tool comes out of every registry
			await Promise.all(syncAllHolderLinks(this, String(existing.id), () => []));
		} catch (error) {
			const { message } = error as Error;
			this.logger.warn(`Could not unlink the Servicely AI Agent Tool from its holders: ${message}`);
		}

		await servicelyApiRequest.call(this, 'DELETE', `/v1/${TOOL_TABLE}/${String(existing.id)}`);
	} catch (error) {
		// Nothing is rethrown, but a real failure still has to leave a trace —
		// otherwise a wrong token or a 500 removes nothing and says nothing.
		const { message } = error as Error;
		if (isNotFound(error as IDataObject) || error instanceof NodeOperationError) {
			this.logger.warn(`Nothing to remove for the Servicely AI Agent Tool: ${message}`);
		} else {
			this.logger.error(`Could not remove the Servicely AI Agent Tool: ${message}`);
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
