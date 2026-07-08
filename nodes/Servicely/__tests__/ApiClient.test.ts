import { describe, expect, it } from 'vitest';

import {
  ServicelyNetworkError,
  ServicelyNotFoundError,
  ServicelyServerError,
  ServicelyValidationError,
} from '../errors';
import { ApiClient } from '../transport/ApiClient';
import { RateLimiter } from '../transport/RateLimiter';
import type { AuthConfig } from '../types';
import { makeHttpStub, makeSleepStub, type HttpStep } from './_stubs';

const auth: AuthConfig = { method: 'bearer', apiToken: 'tok' };

/** An always-open limiter so throttling never interferes with request-shape tests. */
function openLimiter() {
  return new RateLimiter(1_000_000, 1_000_000);
}

function makeClient(script: HttpStep[], opts: { maxRetries?: number } = {}) {
  const http = makeHttpStub(script);
  const sleep = makeSleepStub();
  const client = new ApiClient('https://x.test/', auth, http.fn, {
    maxRetries: opts.maxRetries ?? 3,
    sleep: sleep.fn,
    rateLimiter: openLimiter(),
  });
  return { client, http, sleep };
}

describe('ApiClient request shaping', () => {
  it('strips a trailing slash from the base URL', async () => {
    const { client, http } = makeClient([{ status: 200, body: { data: [] } }]);
    await client.get('User');
    expect(http.calls[0].url).toBe('https://x.test/v1/User');
  });

  it('sends bearer auth, Accept and Content-Type headers', async () => {
    const { client, http } = makeClient([{ status: 200, body: { data: [] } }]);
    await client.get('User');
    expect(http.calls[0].headers?.Authorization).toBe('Bearer tok');
    expect(http.calls[0].headers?.Accept).toBe('application/json');
  });

  it('serializes list params, JSON-encoding the query', async () => {
    const { client, http } = makeClient([{ status: 200, body: { data: [] } }]);
    await client.get('Incident', {
      fields: 'id,Number',
      page: 2,
      page_size: 50,
      order_desc: 'CreatedOn',
      query: { and: [{ fieldName: 'Closed', operator: '=', value: false }] },
    });
    const { qs } = http.calls[0];
    expect(qs).toMatchObject({ fields: 'id,Number', page: 2, page_size: 50, order_desc: 'CreatedOn' });
    expect(qs?.query).toBe(JSON.stringify({ and: [{ fieldName: 'Closed', operator: '=', value: false }] }));
  });

  it('omits the query string entirely when no params are given', async () => {
    const { client, http } = makeClient([{ status: 200, body: { data: [] } }]);
    await client.get('User');
    expect(http.calls[0].qs).toBeUndefined();
  });
});

describe('ApiClient envelope unwrapping + meta', () => {
  it('unwraps a list envelope and extracts header metadata', async () => {
    const { client } = makeClient([
      {
        status: 200,
        headers: { 'x-page': '1', 'x-result-more': 'true', 'x-total-result-count': '14', 'x-rate-limit-cost': '11' },
        body: { data: [{ id: 'a' }, { id: 'b' }] },
      },
    ]);
    const res = await client.get('User');
    expect(res.data).toHaveLength(2);
    expect(res.meta).toMatchObject({ page: 1, hasMore: true, totalResultCount: 14, rateLimitCost: 11 });
  });

  it('parses a JSON string body (when the transport did not pre-parse)', async () => {
    const { client } = makeClient([{ status: 200, body: JSON.stringify({ data: [{ id: 'x' }] }) }]);
    const res = await client.get('User');
    expect(res.data[0].id).toBe('x');
  });

  it('unwraps a single-record envelope for getOne', async () => {
    const { client, http } = makeClient([{ status: 200, body: { data: { id: '42', Name: 'Bob' } } }]);
    const record = await client.getOne('User', '42');
    expect(record).toMatchObject({ id: '42', Name: 'Bob' });
    expect(http.calls[0].url).toBe('https://x.test/v1/User/42');
  });
});

describe('ApiClient write verbs', () => {
  const cases: Array<[string, (c: ApiClient) => Promise<unknown>, string, string]> = [
    ['create → POST', (c) => c.create('Incident', { a: 1 }), 'POST', 'https://x.test/v1/Incident'],
    ['update → PATCH', (c) => c.update('Incident', '7', { a: 1 }), 'PATCH', 'https://x.test/v1/Incident/7'],
    ['replace → PUT', (c) => c.replace('Incident', '7', { a: 1 }), 'PUT', 'https://x.test/v1/Incident/7'],
  ];

  it.each(cases)('%s targets the right method + path', async (_name, run, method, url) => {
    const { client, http } = makeClient([{ status: 200, body: { data: { id: '7' } } }]);
    await run(client);
    expect(http.calls[0].method).toBe(method);
    expect(http.calls[0].url).toBe(url);
  });

  it('delete issues a DELETE and resolves void', async () => {
    const { client, http } = makeClient([{ status: 200, body: {} }]);
    await expect(client.delete('Incident', '7')).resolves.toBeUndefined();
    expect(http.calls[0].method).toBe('DELETE');
  });
});

describe('ApiClient error mapping', () => {
  it('maps 400 to a validation error and surfaces field messages', async () => {
    const { client } = makeClient([
      { status: 400, body: { errors: { request: ['CUSTOM-40006: bad'], ShortDescription: ['required'] } } },
    ]);
    await expect(client.create('Incident', {})).rejects.toBeInstanceOf(ServicelyValidationError);
    await expect(client.create('Incident', {})).rejects.toThrow(/CUSTOM-40006: bad/);
  });

  it('maps 404 to a not-found error', async () => {
    const { client } = makeClient([{ status: 404, body: { errors: { request: ['missing'] } } }]);
    await expect(client.getOne('User', 'nope')).rejects.toBeInstanceOf(ServicelyNotFoundError);
  });

  it('falls back to a default message when no error body is present', async () => {
    const { client } = makeClient([{ status: 401, body: {} }], { maxRetries: 0 });
    await expect(client.get('User')).rejects.toThrow(/authentication failed/i);
  });
});

describe('ApiClient retry + resilience', () => {
  it('retries a 429 then succeeds', async () => {
    const { client, http, sleep } = makeClient([
      { status: 429 },
      { status: 200, body: { data: [{ id: '1' }] } },
    ]);
    const res = await client.get('User');
    expect(res.data).toHaveLength(1);
    expect(http.count()).toBe(2);
    expect(sleep.waits).toHaveLength(1);
  });

  it('honors a numeric Retry-After header (seconds → ms)', async () => {
    const { client, sleep } = makeClient([{ status: 429, headers: { 'retry-after': '2' } }, { status: 200, body: { data: [] } }]);
    await client.get('User');
    expect(sleep.waits).toEqual([2000]);
  });

  it('retries 5xx up to maxRetries then throws a server error', async () => {
    const { client, http } = makeClient([{ status: 503, body: { errors: { request: ['down'] } } }], { maxRetries: 3 });
    await expect(client.get('User')).rejects.toBeInstanceOf(ServicelyServerError);
    expect(http.count()).toBe(4); // 1 + 3 retries
  });

  it('does not retry client errors', async () => {
    const { client, http } = makeClient([{ status: 422, body: { errors: { request: ['blocked'] } } }]);
    await expect(client.delete('Incident', '7')).rejects.toThrow(/blocked/);
    expect(http.count()).toBe(1);
  });

  it('retries network failures then throws a network error', async () => {
    const { client, http } = makeClient([{ throw: 'ECONNREFUSED' }], { maxRetries: 2 });
    await expect(client.get('User')).rejects.toBeInstanceOf(ServicelyNetworkError);
    expect(http.count()).toBe(3);
  });

  it('honors maxRetries: 0 (single attempt)', async () => {
    const { client, http } = makeClient([{ status: 500, body: {} }], { maxRetries: 0 });
    await expect(client.get('User')).rejects.toBeInstanceOf(ServicelyServerError);
    expect(http.count()).toBe(1);
  });

  it('caps a far-future Retry-After date at the max delay', async () => {
    const { client, sleep } = makeClient([
      { status: 429, headers: { 'retry-after': 'Wed, 01 Jan 2200 00:00:00 GMT' } },
      { status: 200, body: { data: [] } },
    ]);
    await client.get('User');
    expect(sleep.waits[0]).toBe(8000);
  });

  it('falls back to backoff when Retry-After is unparseable', async () => {
    const { client, sleep } = makeClient([{ status: 429, headers: { 'retry-after': 'soon' } }, { status: 200, body: { data: [] } }]);
    await client.get('User');
    expect(sleep.waits[0]).toBeGreaterThanOrEqual(0);
    expect(sleep.waits[0]).toBeLessThanOrEqual(500);
  });
});

describe('ApiClient query-string building', () => {
  it('serializes displayValues, relations and ascending order', async () => {
    const { client, http } = makeClient([{ status: 200, body: { data: [] } }]);
    await client.get('User', { displayValues: 'AssignmentGroup', relations: 'Requestor.Name', order: 'CreatedOn' });
    expect(http.calls[0].qs).toMatchObject({ displayValues: 'AssignmentGroup', relations: 'Requestor.Name', order: 'CreatedOn' });
  });
});

describe('ApiClient header + envelope edge cases', () => {
  it('reads a header supplied as a string array', async () => {
    const { client } = makeClient([{ status: 200, headers: { 'x-rate-limit-cost': ['7'] }, body: { data: [] } }]);
    const res = await client.get('User');
    expect(res.meta.rateLimitCost).toBe(7);
  });

  it('returns a bare array body as the list when there is no envelope', async () => {
    const { client } = makeClient([{ status: 200, body: [{ id: 'z' }] }]);
    const res = await client.get('User');
    expect(res.data).toEqual([{ id: 'z' }]);
  });

  it('returns [] when a string body cannot be parsed as JSON', async () => {
    const { client } = makeClient([{ status: 200, body: 'not json' }]);
    const res = await client.get('User');
    expect(res.data).toEqual([]);
  });

  it('returns an un-enveloped single body as-is', async () => {
    const { client } = makeClient([{ status: 200, body: { id: 'q' } }]);
    expect(await client.getOne('User', 'q')).toMatchObject({ id: 'q' });
  });

  it('passes a non-object single body straight through', async () => {
    const { client } = makeClient([{ status: 200, body: 42 }]);
    expect(await client.getOne('User', 'q')).toBe(42);
  });
});

describe('ApiClient error extraction fallbacks', () => {
  it('uses the default message when the 400 body has no errors', async () => {
    const { client } = makeClient([{ status: 400, body: {} }], { maxRetries: 0 });
    await expect(client.get('User')).rejects.toThrow(/request validation failed/i);
  });

  it('ignores a non-object errors field', async () => {
    const { client } = makeClient([{ status: 400, body: { errors: 'oops' } }], { maxRetries: 0 });
    await expect(client.get('User')).rejects.toThrow(/request validation failed/i);
  });
});

describe('ApiClient batch', () => {
  it('POSTs to the batch endpoint and returns the raw batch body', async () => {
    const { client, http } = makeClient([
      { status: 200, body: { id: 'b1', requests: [{ id: 'r1', status_code: 200, body: '{}', execution_time: 1, status_text: 'OK' }] } },
    ]);
    const res = await client.batch([{ id: 'r1', method: 'GET', url: '/v1/User' }]);
    expect(res.id).toBe('b1');
    expect(http.calls[0].method).toBe('POST');
    expect(http.calls[0].url).toBe('https://x.test/v1/_batch');
  });
});

describe('ApiClient dequeue', () => {
  it('POSTs a dequeue action to the Async Integration controller and unwraps the list', async () => {
    const { client, http } = makeClient([
      { status: 200, body: { data: [{ id: 'm1', payload: '{}' }, { id: 'm2', payload: 'x' }] } },
    ]);
    const messages = await client.dequeue({ queue: 'q1', subject: 'act', requestCount: 5 });
    expect(messages).toHaveLength(2);
    expect(http.calls[0].method).toBe('POST');
    expect(http.calls[0].url).toBe('https://x.test/controller/AsyncIntegration');
    expect(http.calls[0].body).toEqual({
      action: 'dequeue',
      identifier: 'n8n',
      queue: 'q1',
      subject: 'act',
      request_count: 5,
    });
  });

  it('returns an empty list when the queue has no messages', async () => {
    const { client } = makeClient([{ status: 200, body: { data: [] } }]);
    await expect(client.dequeue({ queue: 'q1', subject: 'act', requestCount: 5 })).resolves.toEqual([]);
  });

  it('replies to a message with the reply_to/action/status/payload body', async () => {
    const { client, http } = makeClient([{ status: 200, body: {} }]);
    await client.reply({ replyTo: 'm1', action: 'success', status: 'ok', payload: { ok: true } });
    expect(http.calls[0].method).toBe('POST');
    expect(http.calls[0].url).toBe('https://x.test/controller/AsyncIntegration');
    expect(http.calls[0].body).toEqual({
      reply_to: 'm1',
      action: 'success',
      identifier: 'n8n',
      status: 'ok',
      payload: { ok: true },
    });
  });
});

describe('ApiClient with default collaborators', () => {
  it('uses the built-in sleep/rate-limiter when none are injected', async () => {
    const http = makeHttpStub([{ status: 429 }, { status: 200, body: { data: [{ id: '1' }] } }]);
    const client = new ApiClient('https://x.test', auth, http.fn); // all defaults
    const res = await client.get('User');
    expect(res.data).toHaveLength(1);
    expect(http.count()).toBe(2);
  });
});
