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
	type ResponseParameters,
} from '../response';

/**
 * The node types a response node can arrive as: the package prefix n8n gives a
 * community node, an installation under another package name, and the bare name a
 * test fixture uses.
 */
const RESPONSE_NODE_TYPES = [
	'@syn-con/n8n-nodes-servicely.servicelyAiAgentTool',
	'CUSTOM.servicelyAiAgentTool',
	'servicelyAiAgentTool',
];

function makeContext(responseMode: string, childTypes: string[]) {
	return {
		getNodeParameter: (name: string, fallback?: unknown) =>
			name === 'responseMode' ? responseMode : fallback,
		getNode: () => ({ name: 'Servicely AI Agent Tool', type: 'servicelyAiAgentToolTrigger' }),
		getChildNodes: () => childTypes.map((type, index) => ({ name: `n${index}`, type })),
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

	it('evaluates to what the functions answer', () => {
		const evaluate = (expression: string, parameters: ResponseParameters) =>
			// What n8n's expression engine does with the interpolated source
			// eslint-disable-next-line @typescript-eslint/no-implied-eval
			new Function('$parameter', `return ${expression.slice(3, -2)}`)(parameters);

		expect(
			evaluate(responseWebhookFields.responseCode, { options: { responseCode: 202 } }),
		).toBe(202);
		expect(
			evaluate(responseWebhookFields.responseData, {
				responseMode: 'lastNode',
				responseData: 'allEntries',
			}),
		).toBe('allEntries');
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
			checkResponseModeConfiguration(makeContext('responseNode', RESPONSE_NODE_TYPES)),
		).not.toThrow();
		expect(() =>
			checkResponseModeConfiguration(makeContext('onReceived', ['n8n-nodes-base.set'])),
		).not.toThrow();
	});

	it('refuses to answer from a response node the workflow does not have', () => {
		expect(() =>
			checkResponseModeConfiguration(makeContext('responseNode', ['n8n-nodes-base.set'])),
		).toThrow('No Servicely AI Agent Tool Response node found in the workflow');
	});

	it('refuses a response node that would never get to respond', () => {
		for (const mode of ['onReceived', 'lastNode']) {
			expect(() =>
				checkResponseModeConfiguration(makeContext(mode, RESPONSE_NODE_TYPES)),
			).toThrow('Unused Servicely AI Agent Tool Response node found in the workflow');
		}
	});

	// The node's type carries the package it was installed from, which the same
	// node has more than one of over its life.
	it('recognises the response node under any package name', () => {
		for (const type of RESPONSE_NODE_TYPES) {
			expect(() => checkResponseModeConfiguration(makeContext('responseNode', [type]))).not.toThrow();
		}
		expect(() =>
			checkResponseModeConfiguration(makeContext('responseNode', ['other.notAResponseNode'])),
		).toThrow('No Servicely AI Agent Tool Response node found');
	});

	// The trigger's type is the response node's plus "Trigger" — that is what makes
	// the editor show them as one card — so a trigger downstream of a trigger must
	// not read as the thing that answers.
	it('does not mistake another trigger for a response node', () => {
		for (const type of [
			'@syn-con/n8n-nodes-servicely.servicelyAiAgentToolTrigger',
			'servicelyAiAgentToolTrigger',
		]) {
			expect(() => checkResponseModeConfiguration(makeContext('responseNode', [type]))).toThrow(
				'No Servicely AI Agent Tool Response node found',
			);
			expect(() =>
				checkResponseModeConfiguration(makeContext('onReceived', [type])),
			).not.toThrow();
		}
	});
});
