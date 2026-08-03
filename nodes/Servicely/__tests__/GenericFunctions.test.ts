import { NodeApiError } from 'n8n-workflow';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildAndQuery,
  buildListQuery,
  buildSelectors,
  parseAdvancedQuery,
  parseList,
  servicelyApiRequest,
  servicelyApiRequestAllItems,
  toCriterion,
} from '../GenericFunctions';
import { EQUALS_UI_VALUE } from '../constants';
import { makeExecuteCtx, makeHttpStub, makePollCtx, ok } from './_stubs';

/** Retry backoff is `Math.random() * exponential`, so a zeroed random waits 0ms. */
function noBackoff() {
  vi.spyOn(Math, 'random').mockReturnValue(0);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('servicelyApiRequest', () => {
  it('sends the path, method, body, and query string, and unwraps the data envelope', async () => {
    const http = makeHttpStub([ok({ id: '1', Number: 'INC001' })]);
    const ctx = makeExecuteCtx({ http });

    const result = await servicelyApiRequest.call(ctx, 'POST', '/v1/Incident', { ShortDescription: 'x' }, { page: 2 });

    expect(result).toEqual({ id: '1', Number: 'INC001' });
    expect(http.calls).toHaveLength(1);
    const { credentialsType, options } = http.calls[0];
    expect(credentialsType).toBe('servicelyApi');
    expect(options.method).toBe('POST');
    expect(options.url).toBe('/v1/Incident');
    expect(options.body).toEqual({ ShortDescription: 'x' });
    expect(options.qs).toEqual({ page: 2 });
    // The credential's `authenticate` supplies baseURL + auth, so the node must not.
    expect(options.baseURL).toBeUndefined();
    expect(options.headers?.Authorization).toBeUndefined();
    expect(options.returnFullResponse).toBe(true);
    expect(options.ignoreHttpStatusErrors).toBe(true);
  });

  it('omits body and qs when not supplied', async () => {
    const http = makeHttpStub([ok([])]);
    await servicelyApiRequest.call(makeExecuteCtx({ http }), 'GET', '/v1/Incident');

    expect(http.calls[0].options.body).toBeUndefined();
    expect(http.calls[0].options.qs).toBeUndefined();
  });

  it('applies the Request Options timeout and retry budget', async () => {
    const http = makeHttpStub([ok([])]);
    const ctx = makeExecuteCtx({ http, params: { requestOptions: { timeout: 1234, maxRetries: 0 } } });

    await servicelyApiRequest.call(ctx, 'GET', '/v1/Incident');

    expect(http.calls[0].options.timeout).toBe(1234);
  });

  it('passes a payload through unchanged when there is no data envelope', async () => {
    const http = makeHttpStub([{ status: 200, body: { id: 'b1', requests: [] } }]);
    const result = await servicelyApiRequest.call(makeExecuteCtx({ http }), 'POST', '/v1/_batch', {});

    expect(result).toEqual({ id: 'b1', requests: [] });
  });

  it('parses a JSON string body', async () => {
    const http = makeHttpStub([{ status: 200, body: JSON.stringify({ data: [{ id: '1' }] }) }]);
    const result = await servicelyApiRequest.call(makeExecuteCtx({ http }), 'GET', '/v1/Incident');

    expect(result).toEqual([{ id: '1' }]);
  });

  it("surfaces the API's own error messages", async () => {
    const http = makeHttpStub([
      { status: 400, body: { errors: { request: ['CUSTOM-40006: bad field'], State: ['is invalid'] } } },
    ]);
    const ctx = makeExecuteCtx({ http, params: { requestOptions: { maxRetries: 0 } } });

    await expect(servicelyApiRequest.call(ctx, 'GET', '/v1/Incident')).rejects.toThrow(
      'CUSTOM-40006: bad field; is invalid',
    );
  });

  it.each([
    [401, 'Authentication failed'],
    [404, 'Record not found'],
    [422, 'blocked by validation'],
  ])('falls back to a readable message for HTTP %i', async (status, expected) => {
    const http = makeHttpStub([{ status, body: {} }]);
    const ctx = makeExecuteCtx({ http, params: { requestOptions: { maxRetries: 0 } } });

    await expect(servicelyApiRequest.call(ctx, 'GET', '/v1/Incident')).rejects.toThrow(expected);
  });

  it('throws a NodeApiError carrying the HTTP code', async () => {
    const http = makeHttpStub([{ status: 404, body: {} }]);
    const ctx = makeExecuteCtx({ http, params: { requestOptions: { maxRetries: 0 } } });

    const error = await servicelyApiRequest.call(ctx, 'GET', '/v1/Incident/missing').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NodeApiError);
    expect((error as NodeApiError).httpCode).toBe('404');
  });

  it('does not retry 4xx client errors', async () => {
    const http = makeHttpStub([{ status: 400, body: {} }]);
    const ctx = makeExecuteCtx({ http, params: { requestOptions: { maxRetries: 3 } } });

    await expect(servicelyApiRequest.call(ctx, 'GET', '/v1/Incident')).rejects.toThrow();
    expect(http.count()).toBe(1);
  });

  it('retries a 429 and returns the eventual success', async () => {
    noBackoff();
    const http = makeHttpStub([{ status: 429, headers: { 'retry-after': '0' } }, ok([{ id: '1' }])]);
    const ctx = makeExecuteCtx({ http });

    await expect(servicelyApiRequest.call(ctx, 'GET', '/v1/Incident')).resolves.toEqual([{ id: '1' }]);
    expect(http.count()).toBe(2);
  });

  it('retries 5xx up to the budget and then throws', async () => {
    noBackoff();
    const http = makeHttpStub([{ status: 503, body: {} }]);
    const ctx = makeExecuteCtx({ http, params: { requestOptions: { maxRetries: 2 } } });

    await expect(servicelyApiRequest.call(ctx, 'GET', '/v1/Incident')).rejects.toThrow('HTTP 503');
    expect(http.count()).toBe(3);
  });

  it('honours a Retry-After HTTP date', async () => {
    noBackoff();
    const http = makeHttpStub([{ status: 429, headers: { 'retry-after': new Date(0).toUTCString() } }, ok([])]);

    await expect(servicelyApiRequest.call(makeExecuteCtx({ http }), 'GET', '/v1/Incident')).resolves.toEqual([]);
    expect(http.count()).toBe(2);
  });

  it('retries network failures and wraps the final one', async () => {
    noBackoff();
    const http = makeHttpStub([{ throw: 'socket hang up mid-flight' }]);
    const ctx = makeExecuteCtx({ http, params: { requestOptions: { maxRetries: 1 } } });

    const error = await servicelyApiRequest.call(ctx, 'GET', '/v1/Incident').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NodeApiError);
    expect((error as Error).message).toMatch(/Could not reach Servicely/);
    expect(http.count()).toBe(2);
  });

  it('lets n8n map a recognised transport error to its own friendly message', async () => {
    noBackoff();
    const http = makeHttpStub([{ throw: 'ECONNREFUSED' }]);
    const ctx = makeExecuteCtx({ http, params: { requestOptions: { maxRetries: 0 } } });

    await expect(servicelyApiRequest.call(ctx, 'GET', '/v1/Incident')).rejects.toThrow(/refused the connection/);
  });

  it('recovers when a network failure is transient', async () => {
    noBackoff();
    const http = makeHttpStub([{ throw: 'ETIMEDOUT' }, ok([{ id: '1' }])]);

    await expect(servicelyApiRequest.call(makeExecuteCtx({ http }), 'GET', '/v1/Incident')).resolves.toEqual([
      { id: '1' },
    ]);
  });

  it('works from a poll context, whose getNodeParameter takes no item index', async () => {
    const http = makeHttpStub([ok([{ id: '1' }])]);
    const ctx = makePollCtx({ http, params: { requestOptions: { timeout: 99 } } });

    await expect(servicelyApiRequest.call(ctx, 'GET', '/v1/Incident')).resolves.toEqual([{ id: '1' }]);
    expect(http.calls[0].options.timeout).toBe(99);
  });
});

describe('servicelyApiRequestAllItems', () => {
  it('stops on the first short page and concatenates the results', async () => {
    const fullPage = Array.from({ length: 200 }, (_, i) => ({ id: String(i) }));
    const http = makeHttpStub([ok(fullPage), ok([{ id: '200' }])]);

    const records = await servicelyApiRequestAllItems.call(makeExecuteCtx({ http }), '/v1/Incident', { fields: 'id' });

    expect(records).toHaveLength(201);
    expect(http.count()).toBe(2);
    expect(http.calls[0].options.qs).toEqual({ fields: 'id', page: 1, page_size: 200 });
    expect(http.calls[1].options.qs).toEqual({ fields: 'id', page: 2, page_size: 200 });
  });

  it('stops on an empty page', async () => {
    const http = makeHttpStub([ok([])]);
    await expect(servicelyApiRequestAllItems.call(makeExecuteCtx({ http }), '/v1/Incident')).resolves.toEqual([]);
    expect(http.count()).toBe(1);
  });
});

describe('parseList', () => {
  it.each([
    ['1, 2, 3', ['1', '2', '3']],
    ['1, Option Test, 3', ['1', 'Option Test', '3']],
    ["[1, 'Option Test', 3]", ['1', 'Option Test', '3']],
    ['["a","b"]', ['a', 'b']],
    ['', []],
    ['  ', []],
  ])('normalizes %j', (input, expected) => {
    expect(parseList(input)).toEqual(expected);
  });

  it('accepts an array and nullish input', () => {
    expect(parseList(['1', ' Option Test '])).toEqual(['1', 'Option Test']);
    expect(parseList(null)).toEqual([]);
    expect(parseList(undefined)).toEqual([]);
  });
});

describe('toCriterion', () => {
  it('translates the UI Equals token back to the API operator', () => {
    expect(toCriterion({ fieldName: 'State', operator: EQUALS_UI_VALUE, value: 'Open' })).toEqual({
      fieldName: 'State',
      operator: '=',
      value: 'Open',
    });
  });

  it('drops the value for valueless operators', () => {
    expect(toCriterion({ fieldName: 'Notes', operator: 'isempty', value: 'ignored' })).toEqual({
      fieldName: 'Notes',
      operator: 'isempty',
    });
  });

  it('splits list operators into arrays', () => {
    expect(toCriterion({ fieldName: 'State', operator: 'in', value: 'Open, Closed' })).toEqual({
      fieldName: 'State',
      operator: 'in',
      value: ['Open', 'Closed'],
    });
  });

  it('defaults a missing value to an empty string', () => {
    expect(toCriterion({ fieldName: 'State', operator: 'contains' })).toEqual({
      fieldName: 'State',
      operator: 'contains',
      value: '',
    });
  });
});

describe('buildAndQuery', () => {
  it('ignores rows with no field name', () => {
    expect(buildAndQuery([{ fieldName: '', operator: 'contains', value: 'x' }])).toBeUndefined();
  });

  it('combines rows under `and`', () => {
    expect(
      buildAndQuery([
        { fieldName: 'State', operator: EQUALS_UI_VALUE, value: 'Open' },
        { fieldName: 'Notes', operator: 'isnotempty' },
      ]),
    ).toEqual({
      and: [
        { fieldName: 'State', operator: '=', value: 'Open' },
        { fieldName: 'Notes', operator: 'isnotempty' },
      ],
    });
  });
});

describe('parseAdvancedQuery', () => {
  it('returns undefined for empty input', () => {
    expect(parseAdvancedQuery('')).toBeUndefined();
    expect(parseAdvancedQuery('   ')).toBeUndefined();
    expect(parseAdvancedQuery(undefined)).toBeUndefined();
  });

  it('parses a JSON string and passes objects through', () => {
    expect(parseAdvancedQuery('{"and":[]}')).toEqual({ and: [] });
    expect(parseAdvancedQuery({ or: [] })).toEqual({ or: [] });
  });

  it('throws a readable error on malformed JSON', () => {
    expect(() => parseAdvancedQuery('{nope')).toThrow(/Invalid Query JSON/);
  });
});

describe('buildSelectors / buildListQuery', () => {
  it('omits everything that is unset', () => {
    expect(buildListQuery(makeExecuteCtx())).toEqual({});
  });

  it('collects only the selectors for a single-record GET', () => {
    const ctx = makeExecuteCtx({
      params: {
        'options.fields': 'id,Number',
        'options.relations': 'Requestor.Name',
        'options.sortField': 'CreatedOn',
      },
    });

    expect(buildSelectors(ctx)).toEqual({ fields: 'id,Number', relations: 'Requestor.Name' });
  });

  it('adds sort direction and a JSON-encoded query', () => {
    const ctx = makeExecuteCtx({
      params: {
        'options.displayValues': 'Requestor',
        'options.sortField': 'CreatedOn',
        'options.sortDescending': true,
        'filters.conditions': [{ fieldName: 'State', operator: EQUALS_UI_VALUE, value: 'Open' }],
      },
    });

    expect(buildListQuery(ctx)).toEqual({
      displayValues: 'Requestor',
      order_desc: 'CreatedOn',
      query: '{"and":[{"fieldName":"State","operator":"=","value":"Open"}]}',
    });
  });

  it('sorts ascending by default', () => {
    expect(buildListQuery(makeExecuteCtx({ params: { 'options.sortField': 'CreatedOn' } }))).toEqual({
      order: 'CreatedOn',
    });
  });

  it('lets the advanced Query JSON win over the Filters rows', () => {
    const ctx = makeExecuteCtx({
      params: {
        'options.query': '{"or":[{"fieldName":"State","operator":"=","value":"Open"}]}',
        'filters.conditions': [{ fieldName: 'Ignored', operator: EQUALS_UI_VALUE, value: 'x' }],
      },
    });

    expect(buildListQuery(ctx).query).toBe('{"or":[{"fieldName":"State","operator":"=","value":"Open"}]}');
  });
});
