import { describe, expect, it, vi } from 'vitest';

import { executeObjectOperation } from '../handlers/object.handler';
import type { IServicelyClient, ListQueryParams, ServicelyListResult } from '../types';
import { makeCtx } from './_stubs';

/** A mock client whose methods are vi spies; individual tests override returns. */
function mockClient(overrides: Partial<IServicelyClient> = {}): IServicelyClient {
  return {
    get: vi.fn(async () => ({ data: [], meta: { hasMore: false } })),
    getOne: vi.fn(async () => ({ id: '1' })),
    create: vi.fn(async () => ({ id: 'new' })),
    update: vi.fn(async () => ({ id: 'upd' })),
    replace: vi.fn(async () => ({ id: 'rep' })),
    delete: vi.fn(async () => undefined),
    batch: vi.fn(async () => ({ id: 'b', requests: [] })),
    ...overrides,
  };
}

describe('object handler — get', () => {
  it('fetches one record with the selected fields', async () => {
    const client = mockClient({ getOne: vi.fn(async () => ({ id: '5', Number: 'INC5' })) });
    const ctx = makeCtx({ params: { tableName: 'Incident', recordId: '5', 'options.fields': 'id,Number' } });
    const out = await executeObjectOperation(ctx, client, 'get', 0);
    expect(out).toEqual([{ json: { id: '5', Number: 'INC5' } }]);
    expect(client.getOne).toHaveBeenCalledWith('Incident', '5', { fields: 'id,Number' });
  });
});

describe('object handler — getAll', () => {
  it('respects Limit when Return All is false', async () => {
    const get = vi.fn(async (): Promise<ServicelyListResult> => ({
      data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      meta: { hasMore: true },
    }));
    const ctx = makeCtx({ params: { tableName: 'User', returnAll: false, limit: 2 } });
    const out = await executeObjectOperation(ctx, mockClient({ get }), 'getAll', 0);
    expect(out).toHaveLength(2); // sliced to the limit
    expect(get).toHaveBeenCalledWith('User', expect.objectContaining({ page: 1, page_size: 2 }));
  });

  it('paginates until the API reports no more pages when Return All is true', async () => {
    let call = 0;
    const get = vi.fn(async (_t: string, params?: ListQueryParams): Promise<ServicelyListResult> => {
      call += 1;
      expect(params?.page).toBe(call);
      return call === 1
        ? { data: [{ id: 'a' }, { id: 'b' }], meta: { hasMore: true } }
        : { data: [{ id: 'c' }], meta: { hasMore: false } };
    });
    const ctx = makeCtx({ params: { tableName: 'User', returnAll: true } });
    const out = await executeObjectOperation(ctx, mockClient({ get }), 'getAll', 0);
    expect(out.map((i) => (i.json as { id: string }).id)).toEqual(['a', 'b', 'c']);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('parses a JSON query string into the query param', async () => {
    const get = vi.fn(async () => ({ data: [], meta: { hasMore: false } }));
    const query = '{"and":[{"fieldName":"Closed","operator":"=","value":false}]}';
    const ctx = makeCtx({ params: { tableName: 'Incident', returnAll: false, limit: 10, 'options.query': query } });
    await executeObjectOperation(ctx, mockClient({ get }), 'getAll', 0);
    expect(get).toHaveBeenCalledWith('Incident', expect.objectContaining({
      query: { and: [{ fieldName: 'Closed', operator: '=', value: false }] },
    }));
  });

  it('throws a helpful error on invalid query JSON', async () => {
    const ctx = makeCtx({ params: { tableName: 'Incident', returnAll: false, limit: 10, 'options.query': '{not json' } });
    await expect(executeObjectOperation(ctx, mockClient(), 'getAll', 0)).rejects.toThrow(/Invalid Query JSON/);
  });

  it('accepts a query supplied as an object (not a string)', async () => {
    const get = vi.fn(async () => ({ data: [], meta: { hasMore: false } }));
    const queryObj = { or: [{ fieldName: 'State', operator: '=', value: 'Open' }] };
    const ctx = makeCtx({ params: { tableName: 'Incident', returnAll: false, limit: 5, 'options.query': queryObj } });
    await executeObjectOperation(ctx, mockClient({ get }), 'getAll', 0);
    expect(get).toHaveBeenCalledWith('Incident', expect.objectContaining({ query: queryObj }));
  });
});

describe('object handler — simple filters + sort + selectors', () => {
  it('builds an AND query across value, list, and valueless operators', async () => {
    const get = vi.fn(async () => ({ data: [], meta: { hasMore: false } }));
    const ctx = makeCtx({
      params: {
        tableName: 'Incident',
        returnAll: false,
        limit: 10,
        'filters.conditions': [
          { fieldName: 'State', operator: '=', value: 'Open' },
          { fieldName: 'Priority', operator: 'in', value: '1, 2 ,3' },
          { fieldName: 'ClosedOn', operator: 'isempty', value: 'ignored' },
          { fieldName: '', operator: '=', value: 'dropped' },
        ],
      },
    });
    await executeObjectOperation(ctx, mockClient({ get }), 'getAll', 0);
    expect(get).toHaveBeenCalledWith('Incident', expect.objectContaining({
      query: {
        and: [
          { fieldName: 'State', operator: '=', value: 'Open' },
          { fieldName: 'Priority', operator: 'in', value: ['1', '2', '3'] },
          { fieldName: 'ClosedOn', operator: 'isempty' },
        ],
      },
    }));
  });

  it('lets an advanced JSON query override simple filters', async () => {
    const get = vi.fn(async () => ({ data: [], meta: { hasMore: false } }));
    const ctx = makeCtx({
      params: {
        tableName: 'Incident',
        returnAll: false,
        limit: 10,
        'options.query': '{"and":[{"fieldName":"Number","operator":"=","value":"INC1"}]}',
        'filters.conditions': [{ fieldName: 'State', operator: '=', value: 'Open' }],
      },
    });
    await executeObjectOperation(ctx, mockClient({ get }), 'getAll', 0);
    expect(get).toHaveBeenCalledWith('Incident', expect.objectContaining({
      query: { and: [{ fieldName: 'Number', operator: '=', value: 'INC1' }] },
    }));
  });

  it('adds no query when there are no filter rows', async () => {
    const get = vi.fn(async () => ({ data: [], meta: { hasMore: false } }));
    const ctx = makeCtx({ params: { tableName: 'Incident', returnAll: false, limit: 10 } });
    await executeObjectOperation(ctx, mockClient({ get }), 'getAll', 0);
    expect(get.mock.calls[0][1]).not.toHaveProperty('query');
  });

  it('applies ascending and descending sort and passes selectors', async () => {
    const get = vi.fn(async () => ({ data: [], meta: { hasMore: false } }));
    const asc = makeCtx({
      params: { tableName: 'User', returnAll: false, limit: 5, 'options.sortField': 'Name', 'options.displayValues': 'Manager', 'options.relations': 'Manager.Name' },
    });
    await executeObjectOperation(asc, mockClient({ get }), 'getAll', 0);
    expect(get).toHaveBeenCalledWith('User', expect.objectContaining({ order: 'Name', displayValues: 'Manager', relations: 'Manager.Name' }));

    const desc = makeCtx({ params: { tableName: 'User', returnAll: false, limit: 5, 'options.sortField': 'Name', 'options.sortDescending': true } });
    await executeObjectOperation(desc, mockClient({ get }), 'getAll', 0);
    expect(get).toHaveBeenLastCalledWith('User', expect.objectContaining({ order_desc: 'Name' }));
  });
});

describe('object handler — create/update/delete', () => {
  it('collects fieldsToSet into the create payload', async () => {
    const create = vi.fn(async () => ({ id: 'new' }));
    const ctx = makeCtx({
      params: {
        tableName: 'Incident',
        'fieldsToSet.field': [
          { name: 'ShortDescription', value: 'Printer down' },
          { name: 'Priority', value: '1' },
          { name: '', value: 'ignored' },
        ],
      },
    });
    await executeObjectOperation(ctx, mockClient({ create }), 'create', 0);
    expect(create).toHaveBeenCalledWith('Incident', { ShortDescription: 'Printer down', Priority: '1' });
  });

  it('updates by id with the field payload', async () => {
    const update = vi.fn(async () => ({ id: '9' }));
    const ctx = makeCtx({
      params: { tableName: 'Incident', recordId: '9', 'fieldsToSet.field': [{ name: 'State', value: 'Closed' }] },
    });
    await executeObjectOperation(ctx, mockClient({ update }), 'update', 0);
    expect(update).toHaveBeenCalledWith('Incident', '9', { State: 'Closed' });
  });

  it('returns a success summary on delete', async () => {
    const del = vi.fn(async () => undefined);
    const ctx = makeCtx({ params: { tableName: 'Incident', recordId: '9' } });
    const out = await executeObjectOperation(ctx, mockClient({ delete: del }), 'delete', 0);
    expect(out).toEqual([{ json: { success: true, table: 'Incident', id: '9' } }]);
    expect(del).toHaveBeenCalledWith('Incident', '9');
  });
});

describe('object handler — routing', () => {
  it('rejects an unknown operation', async () => {
    const ctx = makeCtx({ params: { tableName: 'User' } });
    await expect(executeObjectOperation(ctx, mockClient(), 'frobnicate', 0)).rejects.toThrow(/Unsupported Object operation/);
  });
});
