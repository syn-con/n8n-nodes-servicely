import type { ILoadOptionsFunctions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import {
  discoverTables,
  listSearchMethods,
  searchActions,
  searchAttachments,
  searchObjectRecords,
  searchParentRecords,
  searchQueues,
  searchTables,
} from '../SearchFunctions';
import { makeHttpStub, makeLoadOptionsCtx, ok, type HttpStep, type ParamMap } from './_stubs';

function ctxFor(script: HttpStep[], params: ParamMap = {}) {
  const http = makeHttpStub(script);
  // Retries are covered in GenericFunctions.test.ts; disable them so the
  // best-effort discovery probes here do not sit in real backoff.
  return { ctx: makeLoadOptionsCtx({ http, params: { requestOptions: { maxRetries: 0 }, ...params } }), http };
}

/** A `_batch` reply where every probed table exists. */
function batchAllOk(count: number): HttpStep {
  return {
    status: 200,
    body: {
      id: 'b1',
      requests: Array.from({ length: count }, (_, i) => ({
        id: String(i + 1),
        body: '',
        execution_time: 1,
        status_code: 200,
        status_text: 'OK',
      })),
    },
  };
}

describe('listSearchMethods', () => {
  it('exposes every picker the descriptions reference', () => {
    expect(Object.keys(listSearchMethods.listSearch).sort()).toEqual([
      'searchActions',
      'searchAttachments',
      'searchObjectRecords',
      'searchParentRecords',
      'searchQueues',
      'searchTables',
    ]);
  });
});

describe('discoverTables', () => {
  it('unions the metadata sources, dedupes case-insensitively, and sorts', async () => {
    const { ctx } = ctxFor([
      ok([{ id: '1', Table: 'Incident' }, { id: '2', Table: 'Change' }, { id: '3', Table: 'incident' }]),
      ok([{ id: '4', Name: 'Asset' }]),
      batchAllOk(3),
    ]);

    await expect(discoverTables(ctx)).resolves.toEqual(['Asset', 'Change', 'Incident']);
  });

  it('matches the source field case-insensitively and skips blank values', async () => {
    const { ctx } = ctxFor([ok([{ id: '1', table: 'Incident' }, { id: '2', table: '  ' }]), ok([]), batchAllOk(1)]);

    await expect(discoverTables(ctx)).resolves.toEqual(['Incident']);
  });

  it('drops candidates whose batch probe returns an error', async () => {
    const { ctx } = ctxFor([
      ok([{ id: '1', Table: 'Incident' }, { id: '2', Table: 'CalendarEvent' }]),
      ok([]),
      {
        status: 200,
        body: {
          id: 'b1',
          requests: [
            { id: '1', body: '', execution_time: 1, status_code: 200, status_text: 'OK' },
            { id: '2', body: '', execution_time: 1, status_code: 404, status_text: 'Not Found' },
          ],
        },
      },
    ]);

    await expect(discoverTables(ctx)).resolves.toEqual(['Incident']);
  });

  it('keeps the candidates unfiltered when batch is unavailable', async () => {
    const { ctx } = ctxFor([
      ok([{ id: '1', Table: 'Incident' }]),
      ok([]),
      { status: 501, body: { errors: { request: ['batch not supported'] } } },
    ]);

    await expect(discoverTables(ctx)).resolves.toEqual(['Incident']);
  });

  it('returns an empty list when no source responds', async () => {
    const { ctx } = ctxFor([{ status: 404, body: {} }]);

    await expect(discoverTables(ctx)).resolves.toEqual([]);
  });
});

describe('searchTables', () => {
  it('maps discovered tables to items and filters them', async () => {
    const { ctx } = ctxFor([ok([{ id: '1', Table: 'Incident' }, { id: '2', Table: 'Change' }]), ok([]), batchAllOk(2)]);

    const result = await searchTables.call(ctx as ILoadOptionsFunctions, 'inc');

    expect(result.results).toEqual([{ name: 'Incident', value: 'Incident' }]);
  });
});

describe('record pickers', () => {
  it('labels records by the first populated label field', async () => {
    const { ctx, http } = ctxFor([ok([{ id: 'r1', Number: 'INC001' }])], { tableName: 'Incident' });

    const result = await searchObjectRecords.call(ctx as ILoadOptionsFunctions);

    expect(http.calls[0].options.url).toBe('/v1/Incident');
    expect(http.calls[0].options.qs).toEqual({ page: 1, page_size: 100 });
    expect(result.results).toEqual([{ name: 'INC001 (r1)', value: 'r1' }]);
  });

  it('unwraps a displayValue object as the label', async () => {
    const { ctx } = ctxFor([ok([{ id: 'r1', Name: { value: 'g1', displayValue: 'Service Desk' } }])], {
      tableName: 'Incident',
    });

    const result = await searchObjectRecords.call(ctx as ILoadOptionsFunctions);

    expect(result.results).toEqual([{ name: 'Service Desk (r1)', value: 'r1' }]);
  });

  it('falls back to the id when no label field is populated', async () => {
    const { ctx } = ctxFor([ok([{ id: 'r1', State: 'Open' }])], { tableName: 'Incident' });

    const result = await searchObjectRecords.call(ctx as ILoadOptionsFunctions);

    expect(result.results).toEqual([{ name: 'r1', value: 'r1' }]);
  });

  it('filters on the value as well as the label', async () => {
    const { ctx } = ctxFor([ok([{ id: 'abc', Number: 'INC001' }, { id: 'xyz', Number: 'INC002' }])], {
      tableName: 'Incident',
    });

    const result = await searchObjectRecords.call(ctx as ILoadOptionsFunctions, 'XY');

    expect(result.results).toEqual([{ name: 'INC002 (xyz)', value: 'xyz' }]);
  });

  it('returns nothing when no table is selected yet', async () => {
    const { ctx, http } = ctxFor([ok([])]);

    await expect(searchObjectRecords.call(ctx as ILoadOptionsFunctions)).resolves.toEqual({ results: [] });
    expect(http.count()).toBe(0);
  });

  it('reads the Attachment resource parent table', async () => {
    const { ctx, http } = ctxFor([ok([{ id: 'r1' }])], { parentTable: 'Change' });

    await searchParentRecords.call(ctx as ILoadOptionsFunctions);

    expect(http.calls[0].options.url).toBe('/v1/Change');
  });

  it('always searches the Attachment table for the attachment picker', async () => {
    const { ctx, http } = ctxFor([ok([{ id: 'a1', FileName: 'x.png' }])]);

    const result = await searchAttachments.call(ctx as ILoadOptionsFunctions);

    expect(http.calls[0].options.url).toBe('/v1/Attachment');
    expect(result.results).toEqual([{ name: 'x.png (a1)', value: 'a1' }]);
  });
});

describe('searchQueues', () => {
  it('lists async-integration provider instances keyed by ConnectionString', async () => {
    const { ctx, http } = ctxFor([
      ok([
        { id: 'p1', Name: 'Incident Queue', ConnectionString: 'incident-queue' },
        { id: 'p2', ConnectionString: 'bare-queue' },
        { id: 'p3', Name: 'No connection string' },
      ]),
    ]);

    const result = await searchQueues.call(ctx as ILoadOptionsFunctions);

    expect(http.calls[0].options.qs?.query).toBe(
      JSON.stringify({ and: [{ fieldName: 'ConnectionType', operator: '=', value: 'async_integration' }] }),
    );
    expect(result.results).toEqual([
      { name: 'Incident Queue (incident-queue)', value: 'incident-queue' },
      { name: 'bare-queue', value: 'bare-queue' },
    ]);
  });
});

describe('searchActions', () => {
  it('resolves the provider instance from the queue, then lists its Actions', async () => {
    const { ctx, http } = ctxFor([ok([{ id: 'p1' }]), ok([{ id: 'a1', Name: 'Process', Command: 'process-incident' }])], {
      queue: 'incident-queue',
    });

    const result = await searchActions.call(ctx as ILoadOptionsFunctions);

    expect(http.calls[0].options.qs).toEqual({
      page: 1,
      page_size: 1,
      query: JSON.stringify({
        and: [
          { fieldName: 'ConnectionType', operator: '=', value: 'async_integration' },
          { fieldName: 'ConnectionString', operator: '=', value: 'incident-queue' },
        ],
      }),
    });
    expect(http.calls[1].options.url).toBe('/v1/Action');
    expect(http.calls[1].options.qs?.query).toBe(
      JSON.stringify({ and: [{ fieldName: 'ProviderInstance', operator: '=', value: 'p1' }] }),
    );
    expect(result.results).toEqual([{ name: 'Process (process-incident)', value: 'process-incident' }]);
  });

  it('returns nothing when no queue is selected', async () => {
    const { ctx, http } = ctxFor([ok([])]);

    await expect(searchActions.call(ctx as ILoadOptionsFunctions)).resolves.toEqual({ results: [] });
    expect(http.count()).toBe(0);
  });

  it('returns nothing when the queue matches no provider instance', async () => {
    const { ctx } = ctxFor([ok([])], { queue: 'ghost-queue' });

    await expect(searchActions.call(ctx as ILoadOptionsFunctions)).resolves.toEqual({ results: [] });
  });

  it('skips Actions with no Command', async () => {
    const { ctx } = ctxFor([ok([{ id: 'p1' }]), ok([{ id: 'a1', Name: 'No command' }])], { queue: 'q' });

    await expect(searchActions.call(ctx as ILoadOptionsFunctions)).resolves.toEqual({ results: [] });
  });
});
