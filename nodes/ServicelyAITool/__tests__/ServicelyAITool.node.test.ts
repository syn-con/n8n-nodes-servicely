import type { IDataObject, IExecuteFunctions, IN8nHttpFullResponse } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { ServicelyAITool } from '../ServicelyAITool.node';

const node = new ServicelyAITool();

const DEFAULTS: IDataObject = {
	respondWith: 'success',
	successResponseCode: 200,
	errorResponseCode: 400,
	data: 'firstIncomingItem',
	errorMessage: 'Request failed',
	errorDetails: '',
	options: {},
};

async function execute(params: IDataObject = {}, items: IDataObject[] = [{ id: 1 }]) {
	const merged = { ...DEFAULTS, ...params };
	const sent: IN8nHttpFullResponse[] = [];

	const ctx = {
		getInputData: () => items.map((json) => ({ json })),
		getNodeParameter: (name: string, _index: number, fallback?: unknown) =>
			name in merged ? merged[name] : fallback,
		getNode: () => ({ name: 'Servicely AI Agent Tool Response' }),
		sendResponse: (response: IN8nHttpFullResponse) => sent.push(response),
	} as unknown as IExecuteFunctions;

	const returned = await node.execute.call(ctx);
	return { response: sent[0], returned };
}

describe('node description', () => {
	it('is registered under the Servicely AI Agent Tool name', () => {
		expect(node.description.name).toBe('servicelyAiAgentTool');
		expect(node.description.displayName).toBe('Servicely AI Agent Tool');
	});
});

describe('execute', () => {
	it('wraps the first incoming item in a success envelope and passes items through', async () => {
		const { response, returned } = await execute();

		expect(response.statusCode).toBe(200);
		expect(response.body).toEqual({ success: true, data: { id: 1 } });
		expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
		expect(returned).toEqual([[{ json: { id: 1 } }]]);
	});

	it('sends the data as is when the envelope is turned off', async () => {
		const { response } = await execute({ options: { envelope: false } });

		expect(response.body).toEqual({ id: 1 });
	});

	it('responds with an error envelope including parsed details', async () => {
		const { response } = await execute({
			respondWith: 'error',
			errorResponseCode: 422,
			errorMessage: 'Validation failed',
			errorDetails: '[{"key":"count"}]',
		});

		expect(response.statusCode).toBe(422);
		expect(response.body).toEqual({
			success: false,
			error: { message: 'Validation failed', details: [{ key: 'count' }] },
		});
	});

	it('responds with all incoming items when asked to', async () => {
		const { response } = await execute({ data: 'allIncomingItems' }, [{ id: 1 }, { id: 2 }]);

		expect(response.body).toEqual({ success: true, data: [{ id: 1 }, { id: 2 }] });
	});

	it('falls back to an empty object when no item reached the node', async () => {
		const { response } = await execute({}, []);

		expect(response.body).toEqual({ success: true, data: {} });
	});

	it('adds the configured message to a success envelope', async () => {
		const { response } = await execute({ options: { message: 'Incident created' } });

		expect(response.body).toEqual({
			success: true,
			message: 'Incident created',
			data: { id: 1 },
		});
	});

	it('sends the JSON body it was given, as a string or already resolved', async () => {
		const fromString = await execute({ data: 'json', responseBody: '{"ok":true}' });
		expect(fromString.response.body).toEqual({ success: true, data: { ok: true } });

		const fromObject = await execute({ data: 'json', responseBody: { ok: false } });
		expect(fromObject.response.body).toEqual({ success: true, data: { ok: false } });
	});

	it('leaves the envelope without a data key when there is no data', async () => {
		const { response } = await execute({ data: 'noData' });

		expect(response.body).toEqual({ success: true });
	});

	it('reports an error without details when none are given', async () => {
		const { response } = await execute({ respondWith: 'error', errorDetails: '   ' });

		expect(response.body).toEqual({ success: false, error: { message: 'Request failed' } });
	});

	it('rejects response body that is not valid JSON', async () => {
		await expect(execute({ data: 'json', responseBody: '{oops' })).rejects.toThrow(
			'The value in "responseBody" is not valid JSON',
		);
	});

	it('drops the body for a status code that must not carry one', async () => {
		const { response } = await execute({ successResponseCode: 204, data: 'noData' });

		expect(response.body).toBeUndefined();
	});

	it('adds configured headers, lowercased, skipping rows without a name', async () => {
		const { response } = await execute({
			options: {
				responseHeaders: {
					entries: [
						{ name: 'X-Request-ID', value: 'abc' },
						// eslint-disable-next-line n8n-nodes-base/node-param-display-name-excess-inner-whitespace, n8n-nodes-base/node-param-display-name-untrimmed -- the whitespace is the fixture: this row is the one the test expects to be dropped
						{ name: '  ', value: 'dropped' },
						{ name: 'X-Empty' },
					],
				},
			},
		});

		expect(response.headers).toEqual({
			'x-request-id': 'abc',
			'x-empty': '',
			'content-type': 'application/json; charset=utf-8',
		});
	});

	it('keeps a content type the workflow set itself', async () => {
		const { response } = await execute({
			options: {
				envelope: false,
				responseHeaders: { entries: [{ name: 'Content-Type', value: 'application/problem+json' }] },
			},
		});

		expect(response.headers['content-type']).toBe('application/problem+json');
	});
});
