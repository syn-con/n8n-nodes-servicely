import { describe, expect, it, vi } from 'vitest';

import { discoverTables } from '../methods/tableDiscovery';
import type { BatchRequest, BatchResponse, BatchSubResponse, IServicelyClient, ServicelyListResult } from '../types';

function sub(id: string, status: number): BatchSubResponse {
  return { id, status_code: status, body: '{}', execution_time: 1, status_text: 'x' };
}

/** A mock client; individual tests override get/batch. */
function mockClient(overrides: Partial<IServicelyClient> = {}): IServicelyClient {
  return {
    get: vi.fn(async () => ({ data: [], meta: { hasMore: false } })),
    getOne: vi.fn(async () => ({ id: '1' })),
    create: vi.fn(async () => ({ id: 'new' })),
    update: vi.fn(async () => ({ id: 'upd' })),
    replace: vi.fn(async () => ({ id: 'rep' })),
    delete: vi.fn(async () => undefined),
    // default: validation batch reports nothing failed → candidates kept as-is
    batch: vi.fn(async () => ({ id: 'b', requests: [] })),
    ...overrides,
  };
}

describe('discoverTables', () => {
  it('unions SequenceNumber.Table and cmdbmetadata.name, deduped and sorted', async () => {
    const get = vi.fn(async (table: string): Promise<ServicelyListResult> => {
      if (/^sequencenumber$/i.test(table)) {
        return {
          // capital 'Table' key exercises case-insensitive matching; junk rows are skipped
          data: [{ Table: 'Incident' }, { Table: 'Change' }, { Table: 'Work' }, { Table: 123 }, { id: 'x' }],
          meta: { hasMore: false },
        };
      }
      if (/^cmdbmetadata$/i.test(table)) {
        return { data: [{ name: 'CmdbCiServer' }, { name: 'incident' }], meta: { hasMore: false } };
      }
      return { data: [], meta: { hasMore: false } };
    });

    const out = await discoverTables(mockClient({ get }));
    // 'incident' dedupes (case-insensitive) against 'Incident'; 123/no-field rows dropped
    expect(out).toEqual(['Change', 'CmdbCiServer', 'Incident', 'Work']);
  });

  it('drops discovered names that do not resolve to a real table (validation 404)', async () => {
    const get = vi.fn(async (table: string): Promise<ServicelyListResult> =>
      /^sequencenumber$/i.test(table)
        ? { data: [{ Table: 'Incident' }, { Table: 'CalendarEvent' }], meta: { hasMore: false } }
        : { data: [], meta: { hasMore: false } },
    );
    const batch = vi.fn(async (reqs: BatchRequest[]): Promise<BatchResponse> => ({
      id: 'b',
      requests: [
        ...reqs.map((r) => sub(r.id, /\/v1\/CalendarEvent/.test(r.url) ? 404 : 200)),
        sub('999', 404), // out-of-range id is ignored, not thrown
      ],
    }));
    const out = await discoverTables(mockClient({ get, batch }));
    expect(out).toEqual(['Incident']);
    expect(batch).toHaveBeenCalled();
  });

  it('keeps candidates unfiltered when batch validation is unavailable', async () => {
    const get = vi.fn(async (table: string): Promise<ServicelyListResult> =>
      /^sequencenumber$/i.test(table)
        ? { data: [{ Table: 'Incident' }, { Table: 'CalendarEvent' }], meta: { hasMore: false } }
        : { data: [], meta: { hasMore: false } },
    );
    const batch = vi.fn(async () => {
      throw new Error('batch unsupported');
    });
    const out = await discoverTables(mockClient({ get, batch }));
    expect(out).toEqual(['CalendarEvent', 'Incident']);
  });

  it('falls through table-name casings until one responds', async () => {
    const get = vi.fn(async (table: string): Promise<ServicelyListResult> => {
      if (table === 'cmdbmetadata') {
        throw new Error('404'); // lowercase misses
      }
      if (table === 'Cmdbmetadata') {
        return { data: [{ name: 'Widget' }], meta: { hasMore: false } }; // PascalCase hits
      }
      return { data: [], meta: { hasMore: false } };
    });
    const out = await discoverTables(mockClient({ get }));
    expect(out).toEqual(['Widget']);
  });

  it('returns [] when every metadata source is unavailable', async () => {
    const out = await discoverTables(
      mockClient({
        get: vi.fn(async () => {
          throw new Error('403 forbidden');
        }),
      }),
    );
    expect(out).toEqual([]);
  });
});
