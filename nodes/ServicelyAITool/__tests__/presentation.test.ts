import type { INodePropertyOptions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import {
	AUTH_DISPLAY_NAME,
	DOCUMENTATION_URL,
	RESPONSE_DISPLAY_NAME,
	SEND_RESPONSE_ACTION,
	TOOL_CODEX,
	TOOL_DISPLAY_NAME,
	TOOL_NODE_TYPE,
	TRIGGER_DISPLAY_NAME,
	TRIGGER_NODE_TYPE,
} from '../presentation';
import { ServicelyAITool } from '../ServicelyAITool.node';
import { ServicelyAIToolTrigger } from '../ServicelyAIToolTrigger.node';

const tool = new ServicelyAITool().description;
const trigger = new ServicelyAIToolTrigger().description;

/**
 * What n8n's node creator does to decide whether a trigger belongs to an app's
 * card (`useActionsGeneration.ts`): the trigger's type with "Trigger" taken out
 * has to be the app's type, and the app has to have at least one action.
 */
const normalizeName = (name: string) => name.replace('Trigger', '');

/** The Actions the card lists for a node: its `operation` options. */
function actions(properties: typeof tool.properties): string[] {
	const operation = properties.find((property) => property.name?.toLowerCase() === 'operation');
	return ((operation?.options ?? []) as INodePropertyOptions[]).map(
		(option) => option.action ?? option.name,
	);
}

describe('the one card the editor shows', () => {
	// The whole point of the naming: one entry in the search, holding both halves
	it('names the trigger so the editor merges it into the tool card', () => {
		expect(normalizeName(TRIGGER_NODE_TYPE)).toBe(TOOL_NODE_TYPE);
		expect(trigger.name).toBe(TRIGGER_NODE_TYPE);
		expect(tool.name).toBe(TOOL_NODE_TYPE);
		// The merge only happens for a trigger, into a node that is not one
		expect(trigger.group).toContain('trigger');
		expect(tool.group).not.toContain('trigger');
	});

	// An app with no actions is not merged into, so the operation is what holds the
	// card together — not decoration.
	it('lists Send a response as the card action', () => {
		expect(actions(tool.properties)).toEqual([SEND_RESPONSE_ACTION]);
	});

	// `operationsCategory` gives up and defers to the resource path if it finds one
	it('declares no resource, which would hide the operation', () => {
		expect(tool.properties.some((property) => property.name === 'resource')).toBe(false);
	});

	// `triggersCategory` returns nothing at all for a display name without it
	it('says "Trigger" in the trigger display name', () => {
		expect(TRIGGER_DISPLAY_NAME.toLowerCase()).toContain('trigger');
		expect(trigger.displayName).toBe(TRIGGER_DISPLAY_NAME);
		// The card takes the app's name, so that one must not say "Trigger"
		expect(tool.displayName).toBe(TOOL_DISPLAY_NAME);
		expect(TOOL_DISPLAY_NAME.toLowerCase()).not.toContain('trigger');
	});

	// The canvas is not the panel: the node dropped from the Triggers half is the
	// tool itself, and its name is what the tool registers under.
	it('keeps the canvas names, and the registered tool name, free of "Trigger"', () => {
		expect(trigger.defaults.name).toBe(TOOL_DISPLAY_NAME);
		expect(tool.defaults.name).toBe(RESPONSE_DISPLAY_NAME);
	});

	it('files and documents both halves as one', () => {
		expect(tool.codex).toBe(TOOL_CODEX);
		expect(trigger.codex).toBe(TOOL_CODEX);
		expect(tool.documentationUrl).toBe(DOCUMENTATION_URL);
		expect(trigger.documentationUrl).toBe(DOCUMENTATION_URL);
		expect(TOOL_CODEX.resources?.primaryDocumentation).toEqual([{ url: DOCUMENTATION_URL }]);
	});

	// A search for either half has to turn up the card
	it('answers the same searches for both halves', () => {
		expect(TOOL_CODEX.alias).toContain('Servicely');
		expect(TOOL_CODEX.alias).toContain('Agent');
		expect(TOOL_CODEX.alias).toContain('Response');
	});

	// The AI sections of the panel mean "a node an n8n agent can call", which is the
	// mirror image of what these do.
	it('stays out of the AI subcategories', () => {
		expect(TOOL_CODEX.subcategories).toBeUndefined();
		expect(TOOL_CODEX.categories).not.toContain('AI');
	});

	it('names the credential after the tool', () => {
		expect(AUTH_DISPLAY_NAME).toBe('Servicely AI Agent Tool Auth');
	});
});
