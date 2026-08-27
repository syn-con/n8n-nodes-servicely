import type { CodexData } from 'n8n-workflow';

/**
 * How the AI Agent Tool feature presents itself.
 *
 * It is two halves: the trigger here, which opens the endpoint a Servicely agent
 * calls and registers the tool with the service desk, and the answer to that
 * call, which is the *AI Agent Tool* resource of the Servicely action node
 * (`nodes/Servicely/actions/aiAgentTool/`). They were two node types until 1.2.0;
 * n8n verification allows a package only one regular node, so the responder moved
 * onto the one the package already had, leaving the trigger — which is allowed
 * alongside it — where it was.
 *
 * The trigger's *type* is unchanged by that move, and has to be: it is what a
 * saved workflow names and what a registered tool record points at. The name
 * still reads as the responder's type plus `Trigger` because that is the string
 * it has always been; nothing merges the two in the node creator any more, so
 * the pair is found by name and alias instead (see {@link TOOL_CODEX}).
 */

/** The stem the trigger's type is built on. Not a node type of its own since 1.2.0. */
const TOOL_TYPE_STEM = 'servicelyAiAgentTool';

/** The trigger's node type. Unchanged since 0.7.0 — a saved workflow names it. */
export const TRIGGER_NODE_TYPE = `${TOOL_TYPE_STEM}Trigger`;

/** The action node that carries the answer, as {@link isResponseNode} matches it. */
export const RESPONSE_NODE_TYPE = 'servicely';

/** The resource of {@link RESPONSE_NODE_TYPE} that answers a tool call. */
export const RESPONSE_RESOURCE = 'aiAgentTool';

/** What the feature is called wherever it is named to a person. */
export const TOOL_DISPLAY_NAME = 'Servicely AI Agent Tool';

/**
 * The trigger's name in the editor. It has to say "Trigger" — that is how the
 * node creator tells a trigger apart when it builds the *Triggers* section of
 * the panel — and it is also what the node is called on the canvas, and what the
 * tool registers under.
 */
export const TRIGGER_DISPLAY_NAME = `${TOOL_DISPLAY_NAME} Trigger`;

/** The endpoint credential, named after the tool it guards. */
export const AUTH_DISPLAY_NAME = `${TOOL_DISPLAY_NAME} Auth`;

/** The one page documenting the trigger and the resource that answers it. */
export const DOCUMENTATION_URL =
	'https://docs-servicely.atlassian.net/wiki/spaces/SD/pages/2077523978';

/**
 * What the node creator files and finds the trigger by.
 *
 * No `subcategories`: the AI sections of the panel carry meanings this node does
 * not have (an "AI › Tools" node is one an n8n agent calls, which this is the
 * mirror image of — it hands a tool to a *Servicely* agent), so it stays out of
 * them and is found by name and alias instead.
 */
export const TOOL_CODEX: CodexData = {
	categories: ['Productivity', 'Utility'],
	alias: [
		'Servicely',
		'AI',
		'Agent',
		'Assistant',
		'Tool',
		'ITSM',
		'ESM',
		'Service Desk',
		'Respond',
		'Response',
	],
	resources: {
		primaryDocumentation: [{ url: DOCUMENTATION_URL }],
	},
};
