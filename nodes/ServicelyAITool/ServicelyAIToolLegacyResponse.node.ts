import type { INodeType, INodeTypeDescription } from 'n8n-workflow';

import { LEGACY_TOOL_NODE_TYPE, RESPONSE_DISPLAY_NAME } from './presentation';
import { ServicelyAITool } from './ServicelyAITool.node';

/**
 * The node that answers a tool call, under the type it was published as. Same
 * reason as its trigger counterpart — see
 * {@link import('./ServicelyAIToolLegacyTrigger.node').ServicelyAIToolLegacyTrigger} —
 * and the trigger's Respond check knows this type too, so a workflow mixing an
 * old response node with a current trigger still passes it.
 *
 * `hidden`, and everything but the name and the operation selector is the current
 * node's by reference. The selector is left out on purpose: it exists to make the
 * editor list this node as an action, which a hidden node never is, and a saved
 * workflow has no value stored for it.
 */
const current = new ServicelyAITool();

export class ServicelyAIToolLegacyResponse implements INodeType {
	description: INodeTypeDescription = {
		...current.description,
		name: LEGACY_TOOL_NODE_TYPE,
		displayName: `${RESPONSE_DISPLAY_NAME} (Legacy)`,
		hidden: true,
		properties: current.description.properties.filter(
			(property) => property.name !== 'operation',
		),
	};

	// As on the trigger: n8n supplies the execution context as `this`
	execute = current.execute;
}
