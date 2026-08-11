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

/** How long the caller waits when the node does not say, in seconds. */
export const DEFAULT_RESPONSE_TIMEOUT_SECONDS = 60;

/**
 * The contexts that read parameters: `IWebhookFunctions` on a call and
 * `IHookFunctions` on activation. Both expose the same two members, so the
 * narrow structural type covers them without naming either.
 */
type ParameterContext = Pick<IHookFunctions, 'getNode' | 'getNodeParameter'>;

/**
 * The tool's parameters, in the order the node declares them.
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

	return definitions;
}

/**
 * The configured response timeout in seconds, for the same reason the parameters
 * live here: the webhook arms its timer with it, and the registration mirrors it
 * into the tool's `TimeoutSeconds` so the service desk stops waiting when this
 * node stops answering.
 *
 * Not sanitised — the webhook decides what an unusable value means (no timer) and
 * the registration decides what it sends instead.
 */
export function readResponseTimeoutSeconds(context: ParameterContext): number {
	return Number(context.getNodeParameter('responseTimeout', DEFAULT_RESPONSE_TIMEOUT_SECONDS));
}
