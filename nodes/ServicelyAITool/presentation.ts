import type { CodexData } from 'n8n-workflow';

/**
 * How the pair presents itself: the AI Agent Tool trigger and its Response node
 * are one feature in two nodes, so what the editor shows for them is written once
 * here rather than kept in step by hand.
 *
 * n8n has no way to make a trigger and a downstream node into a single node — it
 * registers a webhook for every instance of a node type that declares one, so a
 * merged node would open a live endpoint for each node placed in "respond" mode.
 * What can be shared is everything the node creator groups and searches on: the
 * same name stem, the same categories, the same aliases and the same
 * documentation. Searching for any of them turns up both, next to each other.
 */

/** The trigger's name in the editor, and the stem the pair is named after. */
export const TOOL_DISPLAY_NAME = 'Servicely AI Agent Tool';

/** The Response node's name: the trigger's, plus what it does. */
export const RESPONSE_DISPLAY_NAME = `${TOOL_DISPLAY_NAME} Response`;

/** The endpoint credential, named after the tool it guards. */
export const AUTH_DISPLAY_NAME = `${TOOL_DISPLAY_NAME} Auth`;

/** The one page documenting both nodes. */
export const DOCUMENTATION_URL =
	'https://docs-servicely.atlassian.net/wiki/spaces/SD/pages/2077523978';

/**
 * What the node creator files and finds both nodes by. Identical on the two, so
 * they sit together under every category and answer the same searches — including
 * the ones for the half the person is not looking at, since the two are only ever
 * used together.
 *
 * No `subcategories`: the AI sections of the panel carry meanings these nodes do
 * not have (an "AI › Tools" node is one an n8n agent calls, which this is the
 * mirror image of — it hands a tool to a *Servicely* agent), so the pair stays out
 * of them and is found by name and alias instead.
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
