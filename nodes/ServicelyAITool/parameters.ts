import { type IHookFunctions, type INodeProperties, NodeOperationError } from 'n8n-workflow';

import type { ParameterDefinition, ParameterType } from './validation';

/**
 * Reading the node's declared tool parameters, and the Execution Script that
 * carries them. Both sides of the node need them: the webhook validates a call
 * against them, and the registration hooks mirror them into the service desk — so
 * they are read in one place, and a definition the registration rejects is one the
 * webhook would have rejected too.
 *
 * The Options entries deciding what the script is are declared here as well, next
 * to the script text they show — the way `response.ts` declares the options of the
 * Respond modes it implements.
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

/** The Options collection, as far as this module reads it. */
interface ScriptOptions {
	executionScript?: string;
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
 * What the default Execution Script does before it calls the workflow: choose the
 * endpoint from the `IsLiveRun` flag every tool declares — then drop it, so the
 * workflow is not handed a parameter about its own plumbing — and turn the call's
 * parameters into the body.
 *
 * `@@WEBHOOK_URL@@` is resolved at registration (see `registration.ts`); the
 * script quotes it itself, so it is left as the one string it already is.
 */
const SCRIPT_PREAMBLE = `let url = '@@WEBHOOK_URL@@';
if (!parameters.IsLiveRun) {
    url = url.replace("webhook", "webhook-test");
}
delete parameters.IsLiveRun;
let payload;
if (typeof parameters === "string") {
    payload = JSON.parse(parameters) || {};
} else {
    payload = parameters || {};
}`;

/** The call itself, and the answer the service desk gets back from it. */
const SCRIPT_CALL = `const response = HTTP.post(url)
    .accept("application/json")
    .body(JSON.stringify(payload))
    .apiTokenAuth("n8n-webhook")
    .execute();
const code = response.code;
const body = response.getBody();
answer = {
    response: body,
    Success: code >= 200 && code < 300,
    code: code
};`;

/**
 * Whether a parameter name can be read off the payload with a dot. A reserved word
 * can be a property name in a modern engine, but the service desk runs the script
 * in its own, so those take the bracket form too — as does a name with a space in
 * it, which keeps a generated script parseable whatever the parameter is called.
 */
const JS_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const JS_RESERVED = new Set([
	'await',
	'break',
	'case',
	'catch',
	'class',
	'const',
	'continue',
	'debugger',
	'default',
	'delete',
	'do',
	'else',
	'enum',
	'export',
	'extends',
	'false',
	'finally',
	'for',
	'function',
	'if',
	'implements',
	'import',
	'in',
	'instanceof',
	'interface',
	'let',
	'new',
	'null',
	'package',
	'private',
	'protected',
	'public',
	'return',
	'static',
	'super',
	'switch',
	'this',
	'throw',
	'true',
	'try',
	'typeof',
	'var',
	'void',
	'while',
	'with',
	'yield',
]);

/**
 * What the default script does before it fills in a **From Script**
 * parameter: refuse the call unless the service desk can name the user it is
 * acting for, and put that name in `currentUserPrincipal`.
 *
 * Both refusals answer rather than throw, and say which of the two happened in
 * `Status`, so the agent can tell "you are not signed in" from "your account has
 * nothing to identify you by" and tell the person instead of retrying.
 *
 * `currentUserEmail` is read through `typeof` because a script runs in whatever
 * scope the service desk gives it, and a global that is not there would otherwise
 * take the call down with a ReferenceError instead of falling back to the username.
 *
 * Emitted once however many parameters are filled in from it — a second
 * `let currentUserPrincipal` would be a script the service desk refuses to parse.
 */
const SCRIPT_USER_PRINCIPAL = `if (!user.isAuthenticated()) {
    answer = {
        Success: false,
        Status: "rejected",
        Message: "This tool can only be called by an authenticated user."
    };
    return;
}
let currentUserPrincipal = typeof currentUserEmail === "string" ? currentUserEmail : "";
if (!currentUserPrincipal) {
    currentUserPrincipal = user.getUserName();
}
if (!currentUserPrincipal) {
    answer = {
        Success: false,
        Status: "missing_user_identity",
        Message: "This tool could not be called because your user account has neither an email address nor a username available."
    };
    return;
}
payload.currentUserPrincipal = currentUserPrincipal;
`;

/** The one line that carries the named user into the call, as this parameter. */
function scriptParameterAssignment(definition: ParameterDefinition): string {
	const { key } = definition;
	const target =
		JS_IDENTIFIER.test(key) && !JS_RESERVED.has(key)
			? `payload.${key}`
			: `payload[${JSON.stringify(key)}]`;
	return `${target} = currentUserPrincipal;`;
}

/**
 * The default Execution Script for a tool that declares these parameters: the
 * preamble, the signed-in user resolved and assigned to every parameter marked
 * **From Script**, and the call.
 *
 * It is built from the definitions rather than fixed, because such a parameter is
 * one the agent never sends — so unless the script says where the value comes
 * from, nothing does. A tool that marks none of them gets the plain script, with
 * no user check in the way of a call that does not need one.
 */
export function buildExecutionScript(definitions: ParameterDefinition[]): string {
	const fromScript = definitions.filter((definition) => definition.skipExport);
	const blocks = [SCRIPT_PREAMBLE];
	if (fromScript.length > 0) {
		blocks.push(SCRIPT_USER_PRINCIPAL, ...fromScript.map(scriptParameterAssignment));
	}
	blocks.push(SCRIPT_CALL);
	return blocks.join('\n');
}

/**
 * The Execution Script a tool gets when the node does not give it one. It is what
 * actually calls the workflow — a tool registered without a script is a tool that
 * does nothing — so it is a default rather than an empty box, and the node only
 * has to say something here to do something *else*.
 *
 * This is the script for a tool that fills nothing in itself;
 * {@link buildExecutionScript} is what adds the lines for the ones that do.
 */
export const DEFAULT_EXECUTION_SCRIPT = buildExecutionScript([]);

/**
 * The same text as one block comment: the code keeps the shape it has when it is
 * written in for real, with nothing prefixed to its lines to strip off first.
 *
 * Only ever given text of this module's own, which is why nothing here guards
 * against a comment-closing sequence inside it ending the block early.
 */
function commentOut(text: string): string {
	return `/*\n${text}\n*/`;
}

/**
 * What the box shows where the block goes: {@link SCRIPT_USER_PRINCIPAL} itself,
 * as one block comment, so the code a **From Script** parameter is filled in by is
 * read in the editor rather than described to it. A property default is one fixed
 * string — it cannot be built from the rows the way the registered script is — so
 * the line that carries a parameter is named in the note above the block rather
 * than repeated per row, and activation writes the real thing, uncommented, with a
 * line per row.
 *
 * Taken from {@link SCRIPT_USER_PRINCIPAL} and {@link scriptParameterAssignment}
 * rather than written out again, so what the box shows cannot drift from what
 * registers.
 *
 * The note stays true either way: while the box holds a default, activation
 * replaces this; edit the script and it is registered as it stands, comments and
 * all, with those parameters left to it.
 */
const SCRIPT_PARAMETER_TEMPLATE = [
	'// Parameters marked "From Script" are not sent by the agent: the service desk names',
	'// the user the call is being made for. While this box holds the default, activating',
	'// the workflow writes the block below in, uncommented, and one line per such',
	`// parameter after it — ${scriptParameterAssignment({ key: 'callerId', type: 'string', description: '' })}`,
	'// A script you edit is registered exactly as it stands, so a script of your own has',
	'// to fill those parameters in itself.',
	commentOut(SCRIPT_USER_PRINCIPAL),
].join('\n');

/**
 * The script the Execution Script box opens with: the default, with
 * {@link SCRIPT_PARAMETER_TEMPLATE} where a **From Script** parameter's block
 * would go.
 *
 * It is a default and not a script anyone wrote, so {@link readExecutionScript}
 * registers the built script for it rather than this text — the comment never
 * reaches the service desk unless someone edits the box and keeps it.
 */
export const EXECUTION_SCRIPT_TEMPLATE = [
	SCRIPT_PREAMBLE,
	SCRIPT_PARAMETER_TEMPLATE,
	SCRIPT_CALL,
].join('\n');

/** The Execution Script option, declared next to the script text it opens with. */
export const executionScriptOption: INodeProperties = {
	displayName: 'Execution Script',
	name: 'executionScript',
	type: 'string',
	noDataExpression: true,
	typeOptions: {
		rows: 12,
		editor: 'jsEditor',
		editorLanguage: 'javaScript',
	},
	default: EXECUTION_SCRIPT_TEMPLATE,
	description:
		'Script the service desk runs when the agent calls this tool. Exported with it. Add this option only to replace the default script, which posts the call\'s parameters to this workflow and answers with what it returns. The default fills every parameter marked From Script with the signed-in Servicely user — their email address, or their username when the account has no email — and refuses a call it cannot name a user for; the box shows that block commented out where it goes, and activating the workflow writes the real one there; a script you write yourself has to send those values itself. Every "@@WEBHOOK_URL@@" is replaced with this tool\'s webhook URL when the workflow is activated, so the script does not have to be edited when it moves between instances — quoted for you, unless you quoted the placeholder yourself.',
};

/**
 * The contexts that read parameters: `IWebhookFunctions` on a call and
 * `IHookFunctions` on activation. Both expose the same two members, so the
 * narrow structural type covers them without naming either.
 */
type ParameterContext = Pick<IHookFunctions, 'getNode' | 'getNodeParameter'>;

/** The Options collection, as far as this module reads it. */
function scriptOptions(context: ParameterContext): ScriptOptions {
	return context.getNodeParameter('options', {}) as ScriptOptions;
}

/**
 * The script the node asks for, before its `@@WEBHOOK_URL@@` is resolved: what the
 * option holds, or the default built for the parameters the node declares.
 *
 * A blank box counts as "not given" — n8n drops an option left at its default when
 * the workflow is saved, so the default has to be the fallback rather than only the
 * box. So does a script that is still byte-for-byte a default, whether that is
 * {@link EXECUTION_SCRIPT_TEMPLATE} the box opened with or the plain
 * {@link DEFAULT_EXECUTION_SCRIPT} an earlier version of this node stored: nobody
 * wrote either, so marking a parameter **From Script** afterwards adds its
 * lines, and the template's comment is replaced by the lines it describes rather
 * than registered alongside them. Anything else is someone's own script, and is
 * registered as it stands — a hand-written one has to fill those parameters in
 * itself.
 */
export function readExecutionScript(context: ParameterContext): string {
	const written = String(scriptOptions(context).executionScript ?? '');
	const untouched =
		written.trim() === '' ||
		written === EXECUTION_SCRIPT_TEMPLATE ||
		written === DEFAULT_EXECUTION_SCRIPT;
	if (!untouched) {
		return written;
	}
	return buildExecutionScript(readParameterDefinitions(context));
}

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
