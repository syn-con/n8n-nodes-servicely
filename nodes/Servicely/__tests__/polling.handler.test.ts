import { describe, expect, it, vi } from 'vitest';

import { pollObjects } from '../handlers/polling.handler';
import type { IServicelyClient, ServicelyListResult } from '../types';
import { makePollCtx } from './_stubs';

/** A mock client whose `get` is a vi spy; other methods are inert. */
function mockClient(get: IServicelyClient['get']): IServicelyClient {
  return {
    get,
    getOne: vi.fn(async () => ({ id: '1' })),
    create: vi.fn(async () => ({ id: 'new' })),
    update: vi.fn(async () => ({ id: 'upd' })),
    replace: vi.fn(async () => ({ id: 'rep' })),
    delete: vi.fn(async () => undefined),
    batch: vi.fn(async () => ({ id: 'b', requests: [] })),
  };
}

describe('polling handler — pollObjects', () => {
  it('fetches the first page sized to the limit and slices the result', async () => {
    const get = vi.fn(async (): Promise<ServicelyListResult> => ({
      data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      meta: { hasMore: true },
    }));
    const out = await pollObjects(makePollCtx({ params: { tableName: 'User', limit: 2 } }), mockClient(get));
    expect(out).toHaveLength(2);
    expect(get).toHaveBeenCalledWith('User', expect.objectContaining({ page: 1, page_size: 2 }));
  });

  it('builds an AND query from simple filters, selectors, and ascending sort', async () => {
    const get = vi.fn(async () => ({ data: [], meta: { hasMore: false } }));
    const ctx = makePollCtx({
      params: {
        tableName: 'Incident',
        limit: 10,
        'options.fields': 'id,Number',
        'options.sortField': 'CreatedOn',
        'filters.conditions': [
          { fieldName: 'State', operator: '=', value: 'Open' },
          { fieldName: 'Priority', operator: 'in', value: '1, 2 ,3' },
          { fieldName: '', operator: '=', value: 'dropped' },
        ],
      },
    });
    await pollObjects(ctx, mockClient(get));
    expect(get).toHaveBeenCalledWith('Incident', expect.objectContaining({
      fields: 'id,Number',
      order: 'CreatedOn',
      query: {
        and: [
          { fieldName: 'State', operator: '=', value: 'Open' },
          { fieldName: 'Priority', operator: 'in', value: ['1', '2', '3'] },
        ],
      },
    }));
  });

  it('lets an advanced JSON query override simple filters and applies descending sort', async () => {
    const get = vi.fn(async () => ({ data: [], meta: { hasMore: false } }));
    const ctx = makePollCtx({
      params: {
        tableName: 'Incident',
        limit: 5,
        'options.query': '{"or":[{"fieldName":"State","operator":"=","value":"Open"}]}',
        'options.sortField': 'Number',
        'options.sortDescending': true,
        'options.displayValues': 'AssignmentGroup',
        'options.relations': 'Requestor.Name',
        'filters.conditions': [{ fieldName: 'State', operator: '=', value: 'Closed' }],
      },
    });
    await pollObjects(ctx, mockClient(get));
    expect(get).toHaveBeenCalledWith('Incident', expect.objectContaining({
      order_desc: 'Number',
      displayValues: 'AssignmentGroup',
      relations: 'Requestor.Name',
      query: { or: [{ fieldName: 'State', operator: '=', value: 'Open' }] },
    }));
  });

  it('adds no query when there are neither filters nor an advanced query', async () => {
    const get = vi.fn(async () => ({ data: [], meta: { hasMore: false } }));
    await pollObjects(makePollCtx({ params: { tableName: 'User', limit: 10 } }), mockClient(get));
    expect(get.mock.calls[0][1]).not.toHaveProperty('query');
    expect(get.mock.calls[0][1]).not.toHaveProperty('order');
  });

  it('throws a helpful error on invalid advanced query JSON', async () => {
    const get = vi.fn(async () => ({ data: [], meta: { hasMore: false } }));
    const ctx = makePollCtx({ params: { tableName: 'Incident', limit: 10, 'options.query': '{bad' } });
    await expect(pollObjects(ctx, mockClient(get))).rejects.toThrow(/Invalid Query JSON/);
  });
});
