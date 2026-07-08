import { describe, expect, it, vi } from 'vitest';

import { executeQueueOperation, parseQueuePayload, pollQueue } from '../handlers/queue.handler';
import type { AsyncQueueMessage, DequeueRequest, IServicelyQueueClient } from '../types';
import { makeCtx, makePollCtx } from './_stubs';

function mockQueueClient(messages: AsyncQueueMessage[] = []) {
  const dequeue = vi.fn(async (_request: DequeueRequest) => messages);
  const reply = vi.fn(async () => undefined);
  const client: IServicelyQueueClient = { dequeue, reply };
  return { client, dequeue, reply };
}

const QUEUE_PARAMS = { triggerOn: 'queue', queue: '  my-queue  ', subject: ' act ', requestCount: 5 };

describe('queue handler — parseQueuePayload', () => {
  it('parses a JSON object string into an object', () => {
    expect(parseQueuePayload('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses a JSON array string into an array', () => {
    expect(parseQueuePayload('[1,2]')).toEqual([1, 2]);
  });

  it('returns the raw string when it looks like JSON but is malformed', () => {
    expect(parseQueuePayload('{nope')).toBe('{nope');
  });

  it('leaves a plain string untouched', () => {
    expect(parseQueuePayload('hello')).toBe('hello');
  });

  it('passes non-string payloads straight through', () => {
    expect(parseQueuePayload(42)).toBe(42);
    expect(parseQueuePayload(null)).toBeNull();
  });
});

describe('queue handler — pollQueue', () => {
  it('dequeues with the trimmed queue/subject and request count', async () => {
    const { client, dequeue } = mockQueueClient([]);
    const out = await pollQueue(makePollCtx({ params: QUEUE_PARAMS }), client);
    expect(out).toEqual([]);
    expect(dequeue).toHaveBeenCalledWith({ queue: 'my-queue', subject: 'act', requestCount: 5 });
  });

  it('spreads an object payload into json and attaches reply metadata', async () => {
    const { client } = mockQueueClient([{ id: 'm1', payload: '{"Number":"INC1"}' }]);
    const [item] = await pollQueue(makePollCtx({ params: QUEUE_PARAMS }), client);
    expect(item.json).toMatchObject({
      Number: 'INC1',
      _servicely: { replyTo: 'm1', queue: 'my-queue', subject: 'act' },
    });
  });

  it('wraps a non-object payload under `payload`', async () => {
    const { client } = mockQueueClient([{ id: 'm2', payload: 'just text' }]);
    const [item] = await pollQueue(makePollCtx({ params: QUEUE_PARAMS }), client);
    expect(item.json.payload).toBe('just text');
    expect(item.json._servicely).toMatchObject({ replyTo: 'm2' });
  });

  it('wraps an array payload under `payload` (arrays are not spread as json)', async () => {
    const { client } = mockQueueClient([{ id: 'm3', payload: '[1,2,3]' }]);
    const [item] = await pollQueue(makePollCtx({ params: QUEUE_PARAMS }), client);
    expect(item.json.payload).toEqual([1, 2, 3]);
  });

  it('emits one item per claimed message', async () => {
    const { client } = mockQueueClient([
      { id: 'a', payload: 'x' },
      { id: 'b', payload: 'y' },
    ]);
    const out = await pollQueue(makePollCtx({ params: QUEUE_PARAMS }), client);
    expect(out).toHaveLength(2);
  });

  it('defaults the request count when the parameter is absent', async () => {
    const { client, dequeue } = mockQueueClient([]);
    await pollQueue(makePollCtx({ params: { queue: 'q', subject: 's' } }), client);
    expect(dequeue).toHaveBeenCalledWith(expect.objectContaining({ requestCount: 10 }));
  });
});

describe('queue handler — executeQueueOperation', () => {
  it('replies success (success/ok) with the reply id and payload', async () => {
    const { client, reply } = mockQueueClient();
    const ctx = makeCtx({ params: { replyTo: 'm9', payload: { done: true } } });
    const out = await executeQueueOperation(ctx, client, 'replySuccess', 0);
    expect(reply).toHaveBeenCalledWith({ replyTo: 'm9', action: 'success', status: 'ok', payload: { done: true } });
    expect(out).toEqual([{ json: { success: true, replyTo: 'm9', action: 'success' } }]);
  });

  it('replies failure (fail/error)', async () => {
    const { client, reply } = mockQueueClient();
    const ctx = makeCtx({ params: { replyTo: 'm9', payload: 'boom' } });
    await executeQueueOperation(ctx, client, 'replyFailure', 0);
    expect(reply).toHaveBeenCalledWith({ replyTo: 'm9', action: 'fail', status: 'error', payload: 'boom' });
  });

  it('rejects an unknown queue operation', async () => {
    const { client } = mockQueueClient();
    await expect(executeQueueOperation(makeCtx(), client, 'frobnicate', 0)).rejects.toThrow(/Unsupported Queue operation/);
  });
});
