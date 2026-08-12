import { type IHookFunctions, NodeOperationError } from 'n8n-workflow';

import type { ParameterDefinition, ParameterType } from './validation';

/**
 * Reading the node's declared tool parameters. Both sides of the node need them:
 * the webhook validates a call against them, and the registration hooks mirror
 * them into the service desk — so they are read in one place, and a definition
 * the registration rejects is one the webhook would have rejected too.
 */

/** One row of the Parameters collection, as the UI stores it. */
interface ParameterRow {
	paramName?: string;
	paramType?: ParameterType | '';
	paramDescription?: string;
}

interface ParameterCollection {
	values?: ParameterRow[];
}

export const PARAMETER_TYPES: ParameterType[] = ['boolean', 'integer', 'number', 'string'];

/**
 * How long the service desk waits for a tool call to be answered, in seconds,
 * mirrored into the tool's `TimeoutSeconds` on registration.
 *
 * n8n holds the request open for as long as the workflow takes — the Webhook
 * node it follows imposes no deadline of its own — so this is the service
 * desk's patience, and the node has nothing to say about it.
 */
export const DEFAULT_RESPONSE_TIMEOUT_SECONDS = 60;

/**
 * The Execution Script a tool gets when the node does not give it one. It is what
 * actually calls the workflow — a tool registered without a script is a tool that
 * does nothing — so it is a default rather than an empty box, and the node only
 * has to say something here to do something *else*.
 *
 * `@@URL@@` is resolved at registration (see `registration.ts`); the script quotes
 * it itself, so it is left as the one string it already is. The `IsProduction`
 * flag every tool declares picks the endpoint and is then dropped from the
 * payload, so the workflow is not handed a parameter about its own plumbing.
 */
export const DEFAULT_EXECUTION_SCRIPT = `let url = '@@URL@@';
if (!parameters.IsProduction) {
    url = url.replace("webhook", "webhook-test");
}
delete parameters.IsProduction;
let payload;
if (typeof parameters === "string") {
    payload = JSON.parse(parameters) || {};
} else {
    payload = parameters || {};
}
const response = HTTP.post(url)
    .accept("application/json")
    .body(JSON.stringify(payload))
    .apiTokenAuth("n8n-demo-webhook")
    .execute();
const code = response.code;
const body = response.getBody();
answer = {
    response: body,
    Success: code >= 200 && code < 300,
    code: code
};`;

/**
 * The flag every tool carries on top of what the node declares, so a workflow can
 * tell a real call from a rehearsal without each tool having to define it. The
 * description is what the agent reads when it decides what to send, so it states
 * the default outright: true unless the person asked for a test run.
 *
 * A node that declares a parameter of the same name replaces it — its own wording
 * for a flag it already knows about beats this one.
 *
 * It is exported but not validated: no tool asked for it, so a caller that has not
 * caught up with the definition is not worth rejecting over it.
 */
export const PRODUCTION_PARAMETER: ParameterDefinition = {
	key: 'IsProduction',
	type: 'boolean',
	description:
		'Whether this call is for real. Always send true, unless the user explicitly asked to run in test mode — then send false.',
	skipValidation: true,
};

/**
 * The contexts that read parameters: `IWebhookFunctions` on a call and
 * `IHookFunctions` on activation. Both expose the same two members, so the
 * narrow structural type covers them without naming either.
 */
type ParameterContext = Pick<IHookFunctions, 'getNode' | 'getNodeParameter'>;

/**
 * The tool's parameters, in the order the node declares them, with
 * {@link PRODUCTION_PARAMETER} appended — last, so adding it to a tool that is
 * already registered leaves the order of everything else alone.
 *
 * @throws {NodeOperationError} on a row with no name, a duplicate name, or a type
 * outside {@link PARAMETER_TYPES}
 */
export function readParameterDefinitions(context: ParameterContext): ParameterDefinition[] {
	const collection = context.getNodeParameter('parameters', {}) as ParameterCollection;
	const definitions: ParameterDefinition[] = [];
	const seen = new Set<string>();

	for (const row of collection.values ?? []) {
		// `||` and not `??`: an unset field resolves to an empty string, not to undefined
		const key = (row.paramName || '').trim();
		if (!key) {
			throw new NodeOperationError(context.getNode(), 'A parameter is defined without a name');
		}
		if (seen.has(key)) {
			throw new NodeOperationError(
				context.getNode(),
				`The parameter "${key}" is defined more than once`,
			);
		}
		seen.add(key);

		const type = row.paramType || 'string';
		if (!PARAMETER_TYPES.includes(type)) {
			throw new NodeOperationError(
				context.getNode(),
				`The parameter "${key}" has an unknown type "${type}"`,
				{ description: `Use one of: ${PARAMETER_TYPES.join(', ')}.` },
			);
		}

		definitions.push({ key, type, description: (row.paramDescription || '').trim() });
	}

	if (!seen.has(PRODUCTION_PARAMETER.key)) {
		definitions.push(PRODUCTION_PARAMETER);
	}

	return definitions;
}
