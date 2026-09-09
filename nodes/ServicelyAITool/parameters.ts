import { type IHookFunctions, NodeOperationError } from 'n8n-workflow';

import type { ParameterDefinition, ParameterType } from './validation';

/**
 * Reading the node's declared tool parameters. Both sides of the node need them:
 * the webhook validates a call against them, and the registration hooks mirror
 * them into the service desk — so they are read in one place, and a definition the
 * registration rejects is one the webhook would have rejected too.
 *
 * The script that receives them is not the node's: it is kept on the instance, and
 * the node only names the handler holding it — see `handler.ts`.
 */

/** One row of the Parameters collection, as the UI stores it. */
interface ParameterRow {
	paramName?: string;
	paramType?: ParameterType | '';
	paramRequired?: boolean;
	paramFromScript?: boolean;
	paramDescription?: string;
}

interface ParameterCollection {
	values?: ParameterRow[];
}

export const PARAMETER_TYPES: ParameterType[] = ['boolean', 'integer', 'number', 'string'];

/** How long the service desk waits for a tool call when the node does not say. */
export const DEFAULT_RESPONSE_TIMEOUT_SECONDS = 60;

/**
 * The flag every tool carries on top of what the node declares, so a workflow can
 * tell a live call from a rehearsal without each tool having to define it. The
 * description is what the agent reads when it decides what to send, so it states
 * the default outright: true unless the person asked for a test run.
 *
 * A node that declares a parameter of the same name replaces it — its own wording
 * for a flag it already knows about beats this one.
 *
 * It is exported but not validated: no tool asked for it, so a caller that has not
 * caught up with the definition is not worth rejecting over it.
 */
export const LIVE_RUN_PARAMETER: ParameterDefinition = {
	key: 'IsLiveRun',
	type: 'boolean',
	description:
		'Whether this call should really run. Always send true, unless the user explicitly asked to run in test mode — then send false.',
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
 * {@link LIVE_RUN_PARAMETER} appended — last, so adding it to a tool that is
 * already registered leaves the order of everything else alone.
 *
 * A row marked **From Script** is declared here like any other, so the
 * webhook validates it and a call carrying it is not carrying an unknown
 * parameter, and marked `skipExport`, which is what keeps it out of the tool the
 * agent sees.
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

		// `!== false` and not a truthiness test: the box is ticked by default, and n8n
		// leaves a field at its default out of the saved workflow — so an unset row is
		// a required parameter, which is also what every row meant before the box existed
		definitions.push({
			key,
			type,
			// A parameter the script fills in is never exported, so it has no description
			// to export — the field is hidden for it, and whatever an earlier row left
			// there is dropped rather than registered
			description: row.paramFromScript === true ? '' : (row.paramDescription || '').trim(),
			required: row.paramRequired !== false,
			...(row.paramFromScript === true ? { skipExport: true } : {}),
		});
	}

	if (!seen.has(LIVE_RUN_PARAMETER.key)) {
		definitions.push(LIVE_RUN_PARAMETER);
	}

	return definitions;
}

/**
 * The tool's `TimeoutSeconds`: how long the *service desk* waits for a call to be
 * answered before it gives up on the tool. It lives here for the same reason the
 * parameters do — it is part of what the registration mirrors — and it is the
 * only deadline in play, since n8n keeps the request open for as long as the
 * workflow runs.
 *
 * Sanitised, unlike the parameters: the field has to be a number, and neither an
 * emptied box nor a value outside the field's range is one, so the default stands
 * in for it. The registration always sends something, so it cannot be nothing.
 */
export function readToolTimeoutSeconds(context: ParameterContext): number {
	const seconds = Number(
		context.getNodeParameter('responseTimeout', DEFAULT_RESPONSE_TIMEOUT_SECONDS),
	);
	return Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_RESPONSE_TIMEOUT_SECONDS;
}
