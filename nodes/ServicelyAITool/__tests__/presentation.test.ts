import { describe, expect, it } from 'vitest';

import {
	AUTH_DISPLAY_NAME,
	DOCUMENTATION_URL,
	RESPONSE_DISPLAY_NAME,
	TOOL_CODEX,
	TOOL_DISPLAY_NAME,
} from '../presentation';
import { ServicelyAITool } from '../ServicelyAITool.node';
import { ServicelyAIToolTrigger } from '../ServicelyAIToolTrigger.node';

const trigger = new ServicelyAIToolTrigger().description;
const response = new ServicelyAITool().description;

describe('the pair the editor shows', () => {
	it('names both nodes after the tool', () => {
		expect(TOOL_DISPLAY_NAME).toBe('Servicely AI Agent Tool');
		expect(RESPONSE_DISPLAY_NAME).toBe('Servicely AI Agent Tool Response');
		expect(AUTH_DISPLAY_NAME).toBe('Servicely AI Agent Tool Auth');

		expect(trigger.displayName).toBe(TOOL_DISPLAY_NAME);
		expect(response.displayName).toBe(RESPONSE_DISPLAY_NAME);
		// The name a newly added node takes, which is also the registered tool's Name
		expect(trigger.defaults.name).toBe(TOOL_DISPLAY_NAME);
		expect(response.defaults.name).toBe(RESPONSE_DISPLAY_NAME);
	});

	// n8n cannot make a trigger and a downstream node into one node, so what makes
	// them one thing in the panel is filing them identically.
	it('files and documents them as one', () => {
		expect(trigger.codex).toBe(TOOL_CODEX);
		expect(response.codex).toBe(TOOL_CODEX);
		expect(trigger.documentationUrl).toBe(DOCUMENTATION_URL);
		expect(response.documentationUrl).toBe(DOCUMENTATION_URL);
		expect(TOOL_CODEX.resources?.primaryDocumentation).toEqual([{ url: DOCUMENTATION_URL }]);
	});

	// A search for either half has to turn up both: they are only ever used together
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

	// Saved workflows refer to these, so the rename must not have touched them
	it('keeps the node types the saved workflows refer to', () => {
		expect(trigger.name).toBe('servicelyAiTool');
		expect(response.name).toBe('servicelyAiToolResponse');
	});
});
