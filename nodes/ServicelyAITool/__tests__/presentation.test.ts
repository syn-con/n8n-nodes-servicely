import type { INodePropertyOptions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { Servicely } from '../../Servicely/Servicely.node';
import {
	AUTH_DISPLAY_NAME,
	DOCUMENTATION_URL,
	RESPONSE_NODE_TYPE,
	RESPONSE_RESOURCE,
	TOOL_CODEX,
	TOOL_DISPLAY_NAME,
	TRIGGER_DISPLAY_NAME,
	TRIGGER_NODE_TYPE,
} from '../presentation';
import { ServicelyAIToolTrigger } from '../ServicelyAIToolTrigger.node';

const action = new Servicely().description;
const trigger = new ServicelyAIToolTrigger().description;

/** The options of a selector, by name. */
function options(name: string): INodePropertyOptions[] {
	const property = action.properties.find((candidate) => candidate.name === name);
	return (property?.options ?? []) as INodePropertyOptions[];
}

describe('how the AI Agent Tool presents itself', () => {
	// The half that answers is a resource of the action node, not a node of its
	// own — n8n verification allows a package only one regular node.
	it('carries the answer on the action node', () => {
		expect(action.name).toBe(RESPONSE_NODE_TYPE);
		expect(action.group).not.toContain('trigger');

		const resource = options('resource').find((option) => option.value === RESPONSE_RESOURCE);
		expect(resource?.name).toBe('AI Agent Tool');
	});

	it('offers Send Response as the resource operation', () => {
		const operation = action.properties.find(
			(property) =>
				property.name === 'operation' &&
				property.displayOptions?.show?.resource?.includes(RESPONSE_RESOURCE),
		);
		const values = ((operation?.options ?? []) as INodePropertyOptions[]).map(
			(option) => option.value,
		);

		expect(values).toEqual(['sendResponse']);
	});

	// The trigger's type is what a saved workflow names and what a registered tool
	// record points at, so it survived the move unchanged.
	it('keeps the trigger type it has had since 0.7.0', () => {
		expect(TRIGGER_NODE_TYPE).toBe('servicelyAiAgentToolTrigger');
		expect(trigger.name).toBe(TRIGGER_NODE_TYPE);
		expect(trigger.group).toContain('trigger');
	});

	// `triggersCategory` returns nothing at all for a display name without it
	it('says "Trigger" in the trigger display name', () => {
		expect(TRIGGER_DISPLAY_NAME.toLowerCase()).toContain('trigger');
		expect(trigger.displayName).toBe(TRIGGER_DISPLAY_NAME);
	});

	// The canvas is not the panel: the name the trigger drops is what the tool
	// registers under, and the service desk shows it to the people using the agent.
	it('keeps the registered tool name free of "Trigger"', () => {
		expect(trigger.defaults.name).toBe(TOOL_DISPLAY_NAME);
		expect(TOOL_DISPLAY_NAME.toLowerCase()).not.toContain('trigger');
	});

	it('documents the trigger where the resource is documented', () => {
		expect(trigger.codex).toBe(TOOL_CODEX);
		expect(trigger.documentationUrl).toBe(DOCUMENTATION_URL);
		expect(TOOL_CODEX.resources?.primaryDocumentation).toEqual([{ url: DOCUMENTATION_URL }]);
	});

	// Nothing merges the two halves into one card any more, so the searches a
	// person makes for either have to turn the trigger up.
	it('answers the searches made for either half', () => {
		expect(TOOL_CODEX.alias).toContain('Servicely');
		expect(TOOL_CODEX.alias).toContain('Agent');
		expect(TOOL_CODEX.alias).toContain('Response');
	});

	// The AI sections of the panel mean "a node an n8n agent can call", which is the
	// mirror image of what this does.
	it('stays out of the AI subcategories', () => {
		expect(TOOL_CODEX.subcategories).toBeUndefined();
		expect(TOOL_CODEX.categories).not.toContain('AI');
	});

	it('names the credential after the tool', () => {
		expect(AUTH_DISPLAY_NAME).toBe('Servicely AI Agent Tool Auth');
	});
});
