import type { INodeType, INodeTypeDescription } from 'n8n-workflow';

import { LEGACY_TRIGGER_NODE_TYPE, TOOL_DISPLAY_NAME } from './presentation';
import { ServicelyAIToolTrigger } from './ServicelyAIToolTrigger.node';

/**
 * The AI Agent Tool trigger under the type it was published as, so a workflow
 * saved before the pair became one node in the editor still loads and still runs.
 *
 * The type had to change: the node creator only shows a trigger and its action
 * node as one card when the trigger's type is the other's plus `Trigger`, and
 * `servicelyAiTool` was neither. A workflow refers to a node by its type, so
 * dropping the old one would have left every existing tool as an unrecognised
 * node — with its endpoint gone and its registration stranded in the service
 * desk.
 *
 * It is `hidden`, so it is not offered in the editor: nothing new is ever built
 * on it, and what exists keeps working until it is replaced by the current node.
 * Everything else is the current trigger's, by reference — there is no second
 * implementation here to drift, only a second name.
 */
const current = new ServicelyAIToolTrigger();

export class ServicelyAIToolLegacyTrigger implements INodeType {
	description: INodeTypeDescription = {
		...current.description,
		name: LEGACY_TRIGGER_NODE_TYPE,
		displayName: `${TOOL_DISPLAY_NAME} (Legacy)`,
		hidden: true,
	};

	methods = current.methods;

	webhookMethods = current.webhookMethods;

	// n8n calls this with the webhook context as `this`, so the bare method is what
	// it wants — binding it to the node instance would take that context away.
	webhook = current.webhook;
}
