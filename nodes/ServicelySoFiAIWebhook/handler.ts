import {
	type IDataObject,
	type IHookFunctions,
	type ILoadOptionsFunctions,
	type INodeProperties,
	type INodePropertyOptions,
	NodeApiError,
	NodeOperationError,
} from 'n8n-workflow';

import {
	attempt,
	servicelyApiRequest,
	servicelyApiRequestAllItems,
} from '../Servicely/GenericFunctions';
import type { ServicelyRecord } from '../Servicely/types';

/**
 * The Webhook Handler a tool runs: the script the service desk executes when the
 * agent calls the tool is not written on the node any more, it is kept on the
 * instance. The node only says *which* handler to use; activation reads that
 * record and registers the script it holds as the tool's `ExecutionScript`.
 *
 * Which keeps the script where the service desk can version it, and keeps one
 * script serving as many tools as select it — each of them still calling its own
 * endpoint, because the script names it with a placeholder that registration
 * resolves (see `registration.ts`).
 *
 * The selector and the record's field names live together here, the way
 * `response.ts` and `parameters.ts` own the properties they implement.
 */

/** Table holding the handler scripts a tool can be pointed at. */
const HANDLER_TABLE = 'C_n8n_Webhook_Handler';

/** Field holding a handler's display name. A custom table, so its fields are prefixed. */
const HANDLER_NAME_FIELD = 'C_Name';

/** Field holding the script itself, which is what the tool is registered with. */
const HANDLER_SCRIPT_FIELD = 'C_ExecutionScript';

/** Field saying whether the handler may be used at all. */
const HANDLER_ACTIVE_FIELD = 'C_Active';

/**
 * Whether the handler's `C_Active` says yes. The field is written by the service
 * desk, so it can arrive as a boolean, as a number, or as the word the form shows;
 * anything else — the field absent, or an instance that does not keep one — reads
 * as active, since "no such column" is not the same as "switched off".
 */
function isActive(record: ServicelyRecord): boolean {
	const value = record[HANDLER_ACTIVE_FIELD];
	if (value === undefined || value === null || value === '') {
		return true;
	}
	if (typeof value === 'string') {
		return !['false', 'no', '0', 'inactive'].includes(value.trim().toLowerCase());
	}
	return Boolean(value);
}

/** Name of the node parameter holding the selected handler's record id. */
const HANDLER_PARAMETER = 'handler';

/**
 * The instance's webhook handlers, backing the **Handler** selector: every row
 * labelled by its name and storing its record id, which is what the registration
 * fetches the script by. Rows with no id are skipped, since there would be nothing
 * to store, and one repeating an id already seen is dropped.
 *
 * A table that cannot be read leaves the list empty rather than failing the
 * dropdown — an instance without the handler table is one where the field has
 * nothing to offer, and saying so as an empty list beats an error in the panel.
 */
export async function getWebhookHandlers(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const rows = await attempt(() => servicelyApiRequestAllItems.call(this, `/v1/${HANDLER_TABLE}`));
	if (!rows.ok) {
		return [];
	}

	const byId = new Map<string, INodePropertyOptions>();
	for (const row of rows.value as ServicelyRecord[]) {
		const id = row.id === undefined || row.id === null ? '' : String(row.id).trim();
		if (id === '' || byId.has(id)) {
			continue;
		}
		const name = row[HANDLER_NAME_FIELD];
		byId.set(id, { name: typeof name === 'string' && name.trim() !== '' ? name : id, value: id });
	}
	return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The **Handler** selector, declared next to the record it reads. */
export const handlerProperty: INodeProperties = {
	displayName: 'Handler Name or ID',
	name: HANDLER_PARAMETER,
	type: 'options',
	noDataExpression: true,
	typeOptions: {
		loadOptionsMethod: 'getWebhookHandlers',
	},
	default: '',
	required: true,
	description:
		'The Servicely webhook handler whose script this tool runs when the agent calls it. Set it up in Servicely first: Intelligent automation > Intelligent actions > n8n Webhook Handler, with Active set to Yes and an Execution Script containing the "@@WEBHOOK_URL@@" placeholder — activation replaces it with this tool\'s own webhook URL, so one handler serves every tool and is never edited per workflow. Activating fails if the selected handler is gone, is inactive, has an empty script, or has no placeholder in it. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
};

/** The handler record's id, as the node stores it. */
function readHandlerId(ctx: IHookFunctions): string {
	const selected = ctx.getNodeParameter(HANDLER_PARAMETER, '') as unknown;
	return selected === undefined || selected === null ? '' : String(selected).trim();
}

/** The record a GET by id answers with, whether it echoed one object or a list. */
function firstRecord(payload: unknown): ServicelyRecord | undefined {
	return (Array.isArray(payload) ? payload[0] : payload) as ServicelyRecord | undefined;
}

/**
 * Whether a request failed because there is no such record — or no such table.
 * Read exactly as `registration.ts` reads it: this API says so in the message of
 * the error it raises, and answers a plain 404 when it does not.
 */
function isNotFound(failure: IDataObject): boolean {
	if (failure.message && typeof failure.message === 'string') {
		return failure.message.includes('Record not found');
	}
	return failure instanceof NodeApiError && failure.statusCode === 404;
}

/**
 * The script the selected handler holds, which is what the tool is registered to
 * run. Read on every activation, so a handler edited in the service desk reaches
 * every tool that selects it the next time each is activated.
 *
 * Nothing is registered without one: a tool with no script does nothing when the
 * agent calls it, so an unselected handler, a record that is not there and a
 * record with an empty script all stop the activation rather than registering a
 * tool that cannot answer.
 *
 * @throws {NodeOperationError} when no handler is selected, or the selected one
 * cannot be read, or holds no script
 */
export async function readHandlerScript(ctx: IHookFunctions): Promise<string> {
	const id = readHandlerId(ctx);
	if (id === '') {
		throw new NodeOperationError(ctx.getNode(), 'No Servicely webhook handler is selected', {
			description:
				'Choose a Handler on the node: its script is what the service desk runs when the agent calls this tool.',
		});
	}

	const found = await attempt(() =>
		servicelyApiRequest.call(ctx, 'GET', `/v1/${HANDLER_TABLE}/${id}`),
	);
	if (!found.ok) {
		if (!isNotFound(found.failure as IDataObject)) {
			throw found.failure;
		}
		throw new NodeOperationError(
			ctx.getNode(),
			`The selected webhook handler (${id}) is not on this Servicely instance`,
			{
				description: `GET /v1/${HANDLER_TABLE}/${id} answered 404. Pick the handler again — the record, or the whole ${HANDLER_TABLE} table, is not there.`,
			},
		);
	}

	const record = firstRecord(found.value) ?? ({ id } as ServicelyRecord);
	if (!isActive(record)) {
		throw new NodeOperationError(
			ctx.getNode(),
			`The selected webhook handler (${id}) is not active`,
			{
				description: `Set ${HANDLER_ACTIVE_FIELD} to Yes on the handler in Servicely, or select one that is active.`,
			},
		);
	}

	const script = record[HANDLER_SCRIPT_FIELD];
	if (typeof script !== 'string' || script.trim() === '') {
		throw new NodeOperationError(
			ctx.getNode(),
			`The selected webhook handler (${id}) holds no script`,
			{
				description: `Its ${HANDLER_SCRIPT_FIELD} is empty, and a tool registered without a script does nothing when the agent calls it.`,
			},
		);
	}
	return script;
}
