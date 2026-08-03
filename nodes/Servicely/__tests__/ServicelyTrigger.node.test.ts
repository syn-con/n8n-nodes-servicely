import type { IPollFunctions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { ServicelyTrigger, parseQueuePayload } from '../ServicelyTrigger.node';
import { EQUALS_UI_VALUE } from '../constants';
import { makeHttpStub, makePollCtx, ok, type PollCtxOptions } from './_stubs';

const node = new ServicelyTrigger();

/** Run `poll` against a stubbed context. */
async function poll(options: PollCtxOptions) {
  const ctx = makePollCtx(options);
  return node.poll.call(ctx as IPollFunctions);
}

describe('node description', () => {
  it('is a polling trigger with no inputs', () => {
    expect(node.description.polling).toBe(true);
    expect(node.description.inputs).toEqual([]);
    expect(node.description.credentials).toEqual([{ name: 'servicelyApi', required: true }]);
  });
});

describe('parseQueuePayload', () => {
  it('parses JSON objects and arrays', () => {
    expect(parseQueuePayload('{"a":1}')).toEqual({ a: 1 });
    expect(parseQueuePayload(' [1,2] ')).toEqual([1, 2]);
  });

  it('leaves plain strings and non-strings alone', () => {
    expect(parseQueuePayload('hello')).toBe('hello');
    expect(parseQueuePayload('{not json')).toBe('{not json');
    expect(parseQueuePayload(42)).toBe(42);
    expect(parseQueuePayload(null)).toBeNull();
  });
});

describe('queue mode', () => {
  const queueParams = {
    triggerOn: 'queue',
    queue: 'my-queue',
    subject: 'process-incident',
    requestCount: 5,
  };

  it('dequeues with the identifier and request count, spreading object payloads', async () => {
    const http = makeHttpStub([ok([{ id: 'm1', payload: '{"incidentId":"r1"}' }])]);
    const result = await poll({ http, params: queueParams });

    expect(http.calls[0].options.url).toBe('/controller/AsyncIntegration');
    expect(http.calls[0].options.body).toEqual({
      action: 'dequeue',
      identifier: 'n8n',
      queue: 'my-queue',
      subject: 'process-incident',
      request_count: 5,
    });
    expect(result).toEqual([
      [
        {
          json: {
            incidentId: 'r1',
            _servicely: { replyTo: 'm1', queue: 'my-queue', subject: 'process-incident' },
          },
        },
      ],
    ]);
  });

  it('wraps non-object payloads under `payload`', async () => {
    const http = makeHttpStub([ok([{ id: 'm2', payload: 'plain text' }, { id: 'm3', payload: '[1,2]' }])]);
    const result = await poll({ http, params: queueParams });

    expect(result?.[0][0].json.payload).toBe('plain text');
    expect(result?.[0][1].json.payload).toEqual([1, 2]);
  });

  it('defaults the messages-per-poll count', async () => {
    const http = makeHttpStub([ok([])]);
    await poll({ http, params: { triggerOn: 'queue', queue: 'q', subject: 's' } });

    expect(http.calls[0].options.body).toMatchObject({ request_count: 10 });
  });

  it('returns null when the queue is empty so no execution starts', async () => {
    const http = makeHttpStub([ok([])]);
    await expect(poll({ http, params: queueParams })).resolves.toBeNull();
  });

  it('tolerates a response with no message list', async () => {
    const http = makeHttpStub([{ status: 200, body: {} }]);
    await expect(poll({ http, params: queueParams })).resolves.toBeNull();
  });
});

describe('object mode', () => {
  it('polls the table with the filter, sort, and limit', async () => {
    const http = makeHttpStub([ok([{ id: '1' }, { id: '2' }])]);
    const result = await poll({
      http,
      params: {
        triggerOn: 'object',
        tableName: 'Incident',
        limit: 5,
        'options.fields': 'id,Number',
        'options.sortField': 'CreatedOn',
        'options.sortDescending': true,
        'filters.conditions': [{ fieldName: 'Closed', operator: EQUALS_UI_VALUE, value: 'false' }],
      },
    });

    expect(http.calls[0].options.url).toBe('/v1/Incident');
    expect(http.calls[0].options.qs).toEqual({
      fields: 'id,Number',
      order_desc: 'CreatedOn',
      query: '{"and":[{"fieldName":"Closed","operator":"=","value":"false"}]}',
      page: 1,
      page_size: 5,
    });
    expect(result?.[0]).toHaveLength(2);
  });

  it('never emits more than the limit', async () => {
    const http = makeHttpStub([ok([{ id: '1' }, { id: '2' }, { id: '3' }])]);
    const result = await poll({ http, params: { triggerOn: 'object', tableName: 'Incident', limit: 1 } });

    expect(result?.[0]).toHaveLength(1);
  });

  it('returns null when nothing matches', async () => {
    const http = makeHttpStub([ok([])]);
    await expect(poll({ http, params: { triggerOn: 'object', tableName: 'Incident' } })).resolves.toBeNull();
  });
});
