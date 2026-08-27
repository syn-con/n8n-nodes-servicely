import type { IDataObject, IExecuteFunctions, IN8nHttpFullResponse } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { router } from '../actions/router';
import { makeExecuteCtx } from './_stubs';

/**
 * The AI Agent Tool resource: the answer to a call the Servicely AI Agent Tool
 * Trigger let in. Driven through the router rather than the operation module,
 * because the router is what dispatches per item and the response is deliberately
 * built once for the whole batch.
 */

/**
 * A header name that is nothing but whitespace, which the operation drops. Built
 * rather than written out, because n8n's node-param rules read a `name` holding a
 * string literal as a display name and would have this one trimmed — which is the
 * very thing the row exists to test.
 */
const BLANK_HEADER_NAME = ' '.repeat(2);

const DEFAULTS: IDataObject = {
  resource: 'aiAgentTool',
  operation: 'sendResponse',
  respondWith: 'success',
  successResponseCode: 200,
  errorResponseCode: 400,
  data: 'firstIncomingItem',
  errorMessage: 'Request failed',
  errorDetails: '',
  options: {},
};

async function execute(params: IDataObject = {}, items: IDataObject[] = [{ id: 1 }]) {
  const sent: IN8nHttpFullResponse[] = [];
  const ctx = makeExecuteCtx({
    params: { ...DEFAULTS, ...params },
    items: items.map((json) => ({ json })),
  }) as IExecuteFunctions & { sendResponse: (response: IN8nHttpFullResponse) => void };
  ctx.sendResponse = (response) => sent.push(response);

  const returned = await router.call(ctx);
  return { response: sent[0], sent, returned };
}

describe('sendResponse', () => {
  it('wraps the first incoming item in a success envelope and passes items through', async () => {
    const { response, returned } = await execute();

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ success: true, data: { id: 1 } });
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(returned).toEqual([[{ json: { id: 1 }, pairedItem: { item: 0 } }]]);
  });

  // One request gets one answer, however many items the branch carries into the node
  it('answers once for the whole batch and returns every item', async () => {
    const { sent, returned } = await execute({}, [{ id: 1 }, { id: 2 }, { id: 3 }]);

    expect(sent).toHaveLength(1);
    expect(returned).toEqual([
      [
        { json: { id: 1 }, pairedItem: { item: 0 } },
        { json: { id: 2 }, pairedItem: { item: 1 } },
        { json: { id: 3 }, pairedItem: { item: 2 } },
      ],
    ]);
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

  it('rejects a response body that is not valid JSON', async () => {
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
            { name: BLANK_HEADER_NAME, value: 'dropped' },
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
        responseHeaders: {
          entries: [{ name: 'Content-Type', value: 'application/problem+json' }],
        },
      },
    });

    expect(response.headers['content-type']).toBe('application/problem+json');
  });
});
