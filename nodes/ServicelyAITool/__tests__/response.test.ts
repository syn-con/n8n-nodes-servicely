import type { INodeProperties, IWebhookFunctions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import {
	checkResponseModeConfiguration,
	getResponseCode,
	getResponseData,
	responseDataProperty,
	responseModeProperty,
	responseOptions,
	responseWebhookFields,
} from '../response';

/**
 * The node types the Servicely action node can arrive as: the package prefix n8n
 * gives a community node, an installation under another package name, and the
 * bare name a test fixture uses.
 */
const ACTION_NODE_TYPES = [
	'@synergyconsulting/n8n-nodes-servicely.servicely',
	'CUSTOM.servicely',
	'servicely',
];

/** A downstream node, as `getChildNodes` hands it over. */
type Child = { type: string; parameters?: Record<string, unknown> };

/** The Servicely node set to the resource that answers a tool call. */
function responder(type: string): Child {
	return { type, parameters: { resource: 'aiAgentTool', operation: 'sendResponse' } };
}

/** Every way the responder can be spelled, for the cases that want all of them. */
const RESPONDERS = ACTION_NODE_TYPES.map(responder);

function makeContext(responseMode: string, children: Child[]) {
	return {
		getNodeParameter: (name: string, fallback?: unknown) =>
			name === 'responseMode' ? responseMode : fallback,
		getNode: () => ({ name: 'Servicely AI Agent Tool', type: 'servicelyAiAgentToolTrigger' }),
		getChildNodes: () =>
			children.map((child, index) => ({ name: `n${index}`, ...child })),
	} as unknown as IWebhookFunctions;
}

/** Reads an entry of the Options collection the response modes contribute. */
function option(name: string): INodeProperties {
	const found = responseOptions.find((entry) => entry.name === name);
	if (found === undefined) {
		throw new Error(`there is no "${name}" response option`);
	}
	return found;
}

describe('getResponseCode', () => {
	it('answers 200 when the node says nothing', () => {
		expect(getResponseCode({})).toBe(200);
		expect(getResponseCode({ options: {} })).toBe(200);
	});

	it('takes the configured code', () => {
		expect(getResponseCode({ options: { responseCode: 202 } })).toBe(202);
	});

	it('falls back on a code outside the HTTP range or of the wrong type', () => {
		expect(getResponseCode({ options: { responseCode: 99 } })).toBe(200);
		expect(getResponseCode({ options: { responseCode: 600 } })).toBe(200);
		expect(getResponseCode({ options: { responseCode: '201' as unknown as number } })).toBe(200);
	});
});

describe('getResponseData', () => {
	it('says nothing for the response node, which sends the whole response itself', () => {
		expect(getResponseData({ responseMode: 'responseNode' })).toBeUndefined();
		// Even when the options were filled in under another mode and left behind
		expect(
			getResponseData({
				responseMode: 'responseNode',
				responseData: 'allEntries',
				options: { responseData: 'ok', noResponseBody: true },
			}),
		).toBeUndefined();
	});

	it('passes the last node selection on, and leaves the default to n8n', () => {
		expect(getResponseData({ responseMode: 'lastNode', responseData: 'allEntries' })).toBe(
			'allEntries',
		);
		// n8n drops a parameter left at its default, and then defaults it itself
		expect(getResponseData({ responseMode: 'lastNode' })).toBeUndefined();
	});

	it('answers with the custom data of the immediate mode', () => {
		expect(getResponseData({ responseMode: 'onReceived', options: { responseData: 'ok' } })).toBe(
			'ok',
		);
	});

	it('turns "no response body" into noData, in every mode that answers itself', () => {
		expect(
			getResponseData({ responseMode: 'onReceived', options: { noResponseBody: true } }),
		).toBe('noData');
		expect(getResponseData({ responseMode: 'lastNode', options: { noResponseBody: true } })).toBe(
			'noData',
		);
	});

	it('prefers the custom data over an empty body', () => {
		expect(
			getResponseData({
				responseMode: 'onReceived',
				options: { responseData: 'ok', noResponseBody: true },
			}),
		).toBe('ok');
	});
});

describe('the webhook description', () => {
	// n8n evaluates these per request, so both functions have to arrive as source
	// that stands on its own — no imports, no closure over this module.
	it('carries the two rules as functions rather than restating them', () => {
		expect(responseWebhookFields.responseCode).toBe(`={{(${getResponseCode})($parameter)}}`);
		expect(responseWebhookFields.responseData).toBe(`={{(${getResponseData})($parameter)}}`);
		expect(responseWebhookFields.responseMode).toBe('={{$parameter["responseMode"]}}');
	});

	/**
	 * What n8n does at runtime is evaluate the source these fields carry. A test
	 * cannot build a function from that string — n8n's own rules forbid `Function`
	 * in a community node, and the scan reads test files too — so the two halves are
	 * checked separately: the field carries this function's source (above), and the
	 * function answers correctly when called (here). Together they cover what
	 * evaluating the string covered.
	 */
	it('answers from the parameters n8n will pass', () => {
		expect(getResponseCode({ options: { responseCode: 202 } })).toBe(202);
		expect(
			getResponseData({ responseMode: 'lastNode', responseData: 'allEntries' }),
		).toBe('allEntries');
	});

	// The source has to stand on its own to survive the trip through the description,
	// so it may not close over anything this module holds.
	it('carries source that references nothing outside itself', () => {
		for (const source of [String(getResponseCode), String(getResponseData)]) {
			expect(source).not.toMatch(/\brequire\b|\bimport\b/);
			// Every identifier it reads is its own parameter or a literal property of it
			expect(source.startsWith('function') || source.startsWith('(')).toBe(true);
		}
	});
});

describe('the Respond properties', () => {
	it('offers the three modes, answering from the response node by default', () => {
		expect(responseModeProperty.default).toBe('responseNode');
		expect(
			(responseModeProperty.options ?? []).map((entry) => (entry as { value: string }).value),
		).toEqual(['onReceived', 'lastNode', 'responseNode']);
	});

	it('asks what to send only where the last node decides it', () => {
		expect(responseDataProperty.displayOptions?.show?.responseMode).toEqual(['lastNode']);
		expect(
			(responseDataProperty.options ?? []).map((entry) => (entry as { value: string }).value),
		).toEqual(['allEntries', 'firstEntryJson', 'noData']);
		expect(responseDataProperty.default).toBe('firstEntryJson');
	});

	it('keeps the options the response node would contradict away from it', () => {
		expect(option('responseCode').displayOptions?.hide?.['/responseMode']).toEqual([
			'responseNode',
		]);
		expect(option('responseHeaders').displayOptions?.hide?.['/responseMode']).toEqual([
			'responseNode',
		]);
		expect(option('responseData').displayOptions?.show?.['/responseMode']).toEqual(['onReceived']);
		expect(option('noResponseBody').displayOptions?.show?.['/responseMode']).toEqual([
			'onReceived',
		]);
	});
});

describe('checkResponseModeConfiguration', () => {
	it('lets a workflow whose wiring matches its Respond setting through', () => {
		expect(() =>
			checkResponseModeConfiguration(makeContext('responseNode', RESPONDERS)),
		).not.toThrow();
		expect(() =>
			checkResponseModeConfiguration(makeContext('onReceived', [{ type: 'n8n-nodes-base.set' }])),
		).not.toThrow();
	});

	it('refuses to answer from a responder the workflow does not have', () => {
		expect(() =>
			checkResponseModeConfiguration(
				makeContext('responseNode', [{ type: 'n8n-nodes-base.set' }]),
			),
		).toThrow('No Servicely node set to "AI Agent Tool" found in the workflow');
	});

	it('refuses a responder that would never get to respond', () => {
		for (const mode of ['onReceived', 'lastNode']) {
			expect(() => checkResponseModeConfiguration(makeContext(mode, RESPONDERS))).toThrow(
				'Unused Servicely node set to "AI Agent Tool" found in the workflow',
			);
		}
	});

	// The node's type carries the package it was installed from, which the same
	// node has more than one of over its life.
	it('recognises the responder under any package name', () => {
		for (const type of ACTION_NODE_TYPES) {
			expect(() =>
				checkResponseModeConfiguration(makeContext('responseNode', [responder(type)])),
			).not.toThrow();
		}
		expect(() =>
			checkResponseModeConfiguration(makeContext('responseNode', [{ type: 'other.somethingElse' }])),
		).toThrow('No Servicely node set to "AI Agent Tool" found');
	});

	// A Servicely node is in almost every one of these workflows, doing the work the
	// tool was called for. Only the one set to answer counts as the answer.
	it('does not mistake a Servicely node on another resource for the responder', () => {
		for (const parameters of [
			undefined,
			{},
			{ resource: 'object', operation: 'get' },
			{ resource: 'queue', operation: 'replySuccess' },
		]) {
			const children = [{ type: 'servicely', parameters }];

			expect(() => checkResponseModeConfiguration(makeContext('responseNode', children))).toThrow(
				'No Servicely node set to "AI Agent Tool" found',
			);
			expect(() =>
				checkResponseModeConfiguration(makeContext('onReceived', children)),
			).not.toThrow();
		}
	});

	// The trigger's type is the action node's stem plus a suffix, and neither
	// trigger must read as the thing that answers.
	it('does not mistake a trigger for the responder', () => {
		for (const type of [
			'@synergyconsulting/n8n-nodes-servicely.servicelyAiAgentToolTrigger',
			'servicelyAiAgentToolTrigger',
			'@synergyconsulting/n8n-nodes-servicely.servicelyTrigger',
			'servicelyTrigger',
		]) {
			const children = [{ type, parameters: { resource: 'aiAgentTool' } }];

			expect(() => checkResponseModeConfiguration(makeContext('responseNode', children))).toThrow(
				'No Servicely node set to "AI Agent Tool" found',
			);
			expect(() =>
				checkResponseModeConfiguration(makeContext('onReceived', children)),
			).not.toThrow();
		}
	});

	// The guard is the only thing that reads the parameters, so it has to ask for
	// them: without the flag n8n leaves `parameters` off every child.
	it('asks for the child nodes with their parameters', () => {
		const calls: Array<unknown> = [];
		const context = {
			getNodeParameter: () => 'onReceived',
			getNode: () => ({ name: 'Servicely AI Agent Tool', type: 'servicelyAiAgentToolTrigger' }),
			getChildNodes: (_name: string, options?: unknown) => {
				calls.push(options);
				return [];
			},
		} as unknown as IWebhookFunctions;

		checkResponseModeConfiguration(context);

		expect(calls).toEqual([{ includeNodeParameters: true }]);
	});
});
