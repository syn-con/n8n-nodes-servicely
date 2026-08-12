import type { CodexData } from 'n8n-workflow';

/**
 * How the pair presents itself. The AI Agent Tool trigger and the node that
 * answers a tool call are one feature, and n8n's node creator will show them as
 * one card — the trigger under *Triggers*, the responder under *Actions* — but
 * only if they are named the way it expects, so those names are written once
 * here instead of being kept in step by hand.
 *
 * What the editor actually does (`useActionsGeneration.ts`): it walks the
 * non-trigger nodes and gives each an *app* card holding its actions, then walks
 * the triggers and, for each, looks for an app whose type name equals
 * `trigger.name.replace('Trigger', '')`. A match with at least one action merges
 * the two. Hence:
 *
 * - the trigger's type is the responder's type plus `Trigger`,
 * - the responder carries an `operation` property, since a card with no actions
 *   is not merged into,
 * - the trigger's *display* name contains "Trigger", which is what makes the
 *   editor offer it as a trigger at all.
 *
 * Break any one of those and the two quietly become two cards again, which is
 * what `__tests__/presentation.test.ts` is guarding.
 */

/** The responder's node type — the stem the pair is built on. */
export const TOOL_NODE_TYPE = 'servicelyAiAgentTool';

/** The trigger's node type. The suffix is what merges the two in the panel. */
export const TRIGGER_NODE_TYPE = `${TOOL_NODE_TYPE}Trigger`;

/**
 * The types this pair was published under before it was one card, kept alive by
 * the hidden nodes next to each of them so a saved workflow still loads and runs.
 * New workflows never get these: the editor does not offer a hidden node.
 */
export const LEGACY_TRIGGER_NODE_TYPE = 'servicelyAiTool';
export const LEGACY_TOOL_NODE_TYPE = 'servicelyAiToolResponse';

/** The card's name, and the responder's, since the card takes the app's name. */
export const TOOL_DISPLAY_NAME = 'Servicely AI Agent Tool';

/**
 * The trigger's name in the editor. It has to say "Trigger" — that is how the
 * node creator tells a trigger apart when it builds the *Triggers* half of the
 * card — while the node it drops on the canvas is still called
 * {@link TOOL_DISPLAY_NAME}, which is also the name its tool registers under.
 */
export const TRIGGER_DISPLAY_NAME = `${TOOL_DISPLAY_NAME} Trigger`;

/** What the responder is called on the canvas, where it sits next to the trigger. */
export const RESPONSE_DISPLAY_NAME = `${TOOL_DISPLAY_NAME} Response`;

/** The endpoint credential, named after the tool it guards. */
export const AUTH_DISPLAY_NAME = `${TOOL_DISPLAY_NAME} Auth`;

/** How the responder's one operation reads in the Actions list of the card. */
export const SEND_RESPONSE_ACTION = 'Send a response';

/** The one page documenting both nodes. */
export const DOCUMENTATION_URL =
	'https://docs-servicely.atlassian.net/wiki/spaces/SD/pages/2077523978';

/**
 * What the node creator files and finds both nodes by. Identical on the two, so
 * the card answers every search either half would — including the ones for the
 * half the person is not looking at, since the two are only ever used together.
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
