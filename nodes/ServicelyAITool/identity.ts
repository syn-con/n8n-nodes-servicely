import { type IHookFunctions, NodeOperationError } from 'n8n-workflow';

/**
 * Who a registered tool is: the record's Key, its Name and its Description, all
 * taken from the node that declares it.
 *
 * The node is the unit of registration — one AI Tool node is one tool — so its
 * id is what a tool is found by and its name is what the tool is called. Both
 * are n8n's own: the id survives everything a workflow can do to a node except
 * deleting it, and the name is what the person building the workflow already
 * used to say what this tool does.
 */

/** Marks a tool record as maintained by n8n rather than edited in the service desk. */
export const NAME_PREFIX = '[n8n]';

/** Where n8n serves a workflow's own page, under the instance base URL. */
const WORKFLOW_URL_SEGMENT = 'workflow';

/**
 * The node id, which is the tool's Key. n8n gives a node its id when it is added
 * to the canvas, so this is only absent for a workflow assembled outside the
 * editor.
 */
export function toolKey(ctx: IHookFunctions): string {
	const { id } = ctx.getNode();
	if (!id) {
		throw new NodeOperationError(ctx.getNode(), 'The node has no id yet', {
			description: 'Save the workflow before activating it, so the tool can be registered.',
		});
	}
	return String(id);
}

/**
 * The tool's name in the service desk: the node's own name, marked as n8n's.
 * Renaming the node renames the tool on the next activation, so two tools in one
 * workflow are told apart by naming their nodes after what they do.
 */
export function toolName(ctx: IHookFunctions): string {
	return `${NAME_PREFIX} ${ctx.getNode().name}`;
}

/**
 * The workflow's page on this n8n instance, so someone reading the record in the
 * service desk can open what registered the tool. Left out when the instance
 * cannot say where it is reachable, or the workflow has no id to point at.
 */
function workflowUrl(ctx: IHookFunctions): string | undefined {
	const { id } = ctx.getWorkflow();
	const base = ctx.getInstanceBaseUrl?.() ?? '';
	if (!id || !base) {
		return undefined;
	}
	// n8n reports the base URL with or without its trailing slash, depending on how
	// it was configured
	return `${base.replace(/\/+$/, '')}/${WORKFLOW_URL_SEGMENT}/${String(id)}`;
}

/**
 * Where the tool came from, for someone reading the record in the service desk:
 * the node that declares it, the workflow it sits in, and a link to that
 * workflow. Whatever cannot be resolved is left out rather than named as unknown.
 */
export function toolDescription(ctx: IHookFunctions): string {
	const { name, id } = ctx.getWorkflow();
	const workflow = name ?? (id === undefined ? undefined : String(id));
	const url = workflowUrl(ctx);

	const origin =
		workflow === undefined
			? `Created by the "${ctx.getNode().name}" node in n8n`
			: `Created by the "${ctx.getNode().name}" node of the n8n workflow "${workflow}"`;

	return url === undefined ? origin : `${origin} (${url})`;
}
