import type { ILoadOptionsFunctions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import {
  discoverFields,
  discoverTables,
  getFields,
  listSearchMethods,
  searchActions,
  searchAttachments,
  searchControllers,
  searchObjectRecords,
  searchParentRecords,
  searchQueues,
  searchTables,
} from '../SearchFunctions';
import {
  makeHttpStub,
  makeLoadOptionsCtx,
  makeRoutedHttpStub,
  ok,
  type HttpStep,
  type HttpStub,
  type ParamMap,
} from './_stubs';

/** Retries are covered in GenericFunctions.test.ts; disable them so the
 * best-effort discovery probes here do not sit in real backoff. */
function ctxWith(http: HttpStub, params: ParamMap = {}) {
  return { ctx: makeLoadOptionsCtx({ http, params: { requestOptions: { maxRetries: 0 }, ...params } }), http };
}

function ctxFor(script: HttpStep[], params: ParamMap = {}) {
  return ctxWith(makeHttpStub(script), params);
}

/** A page of `size` throwaway records, so a picker sees a "full" page. */
function fullPage(size: number, prefix = 'r') {
  return Array.from({ length: size }, (_, i) => ({ id: `${prefix}${i}`, Name: `${prefix}-name-${i}` }));
}

/** The page size a searchable picker requests (SEARCH_PAGE_SIZE). */
const PICKER_PAGE_SIZE = 100;

/** The page size registry reads request (DISCOVERY_PAGE_SIZE). */
const DISCOVERY_PAGE_SIZE = 2000;

describe('listSearchMethods', () => {
  it('exposes every picker the descriptions reference', () => {
    expect(Object.keys(listSearchMethods.listSearch).sort()).toEqual([
      'searchActions',
      'searchAttachments',
      'searchControllers',
      'searchObjectRecords',
      'searchParentRecords',
      'searchQueues',
      'searchTables',
    ]);
  });

  it('exposes every loadOptions method the descriptions reference', () => {
    expect(Object.keys(listSearchMethods.loadOptions).sort()).toEqual(['getFields']);
  });
});

describe('discoverTables', () => {
  it('reads TableDefinition, labelling by Table and keying by id', async () => {
    const { ctx, http } = ctxFor([
      ok([
        { id: 'Incident', Table: 'Incident' },
        { id: 'ITSMRequest', Table: 'Service Request' },
      ]),
    ]);

    const tables = await discoverTables(ctx);

    expect(http.calls[0].options.url).toBe('/v1/TableDefinition');
    expect(http.calls[0].options.qs).toEqual({ page: 1, page_size: DISCOVERY_PAGE_SIZE });
    expect(tables).toEqual([
      { name: 'Incident', value: 'Incident' },
      { name: 'Service Request', value: 'ITSMRequest' },
    ]);
  });

  it('sorts by label and dedupes repeated ids', async () => {
    const { ctx } = ctxFor([
      ok([
        { id: 'Change', Table: 'Zulu' },
        { id: 'Asset', Table: 'Alpha' },
        { id: 'Change', Table: 'Duplicate' },
      ]),
    ]);

    await expect(discoverTables(ctx)).resolves.toEqual([
      { name: 'Alpha', value: 'Asset' },
      { name: 'Zulu', value: 'Change' },
    ]);
  });

  it('falls back to the id when the label field is blank', async () => {
    const { ctx } = ctxFor([ok([{ id: 'Incident', Table: '  ' }])]);

    await expect(discoverTables(ctx)).resolves.toEqual([{ name: 'Incident', value: 'Incident' }]);
  });

  it('returns an empty list when the registry does not respond', async () => {
    const { ctx } = ctxFor([{ status: 404, body: {} }]);

    await expect(discoverTables(ctx)).resolves.toEqual([]);
  });
});

describe('searchTables', () => {
  it('filters the registry entries client-side', async () => {
    const { ctx } = ctxFor([
      ok([
        { id: 'Incident', Table: 'Incident' },
        { id: 'Change', Table: 'Change' },
      ]),
    ]);

    const result = await searchTables.call(ctx as ILoadOptionsFunctions, 'inc');

    expect(result.results).toEqual([{ name: 'Incident', value: 'Incident' }]);
  });
});

describe('discoverFields', () => {
  it('queries FieldDefinition by Table and returns sorted FieldNames', async () => {
    const { ctx, http } = ctxFor([
      ok([
        { id: 'f1', FieldName: 'State' },
        { id: 'f2', FieldName: 'AssignmentGroup' },
      ]),
    ]);

    const fields = await discoverFields(ctx, 'Incident');

    expect(http.calls[0].options.url).toBe('/v1/FieldDefinition');
    expect(http.calls[0].options.qs).toEqual({
      page: 1,
      page_size: DISCOVERY_PAGE_SIZE,
      query: JSON.stringify({ and: [{ fieldName: 'Table', operator: '=', value: 'Incident' }] }),
    });
    expect(fields).toEqual(['AssignmentGroup', 'State']);
  });

  it('dedupes names and skips rows with no FieldName', async () => {
    const { ctx } = ctxFor([
      ok([{ id: 'f1', FieldName: 'State' }, { id: 'f2', FieldName: 'State' }, { id: 'f3', Label: 'no name' }]),
    ]);

    await expect(discoverFields(ctx, 'Incident')).resolves.toEqual(['State']);
  });

  it('makes no request when no table is given', async () => {
    const { ctx, http } = ctxFor([ok([])]);

    await expect(discoverFields(ctx, '')).resolves.toEqual([]);
    expect(http.count()).toBe(0);
  });

  it('returns an empty list when the registry does not respond', async () => {
    const { ctx } = ctxFor([{ status: 404, body: {} }]);

    await expect(discoverFields(ctx, 'Incident')).resolves.toEqual([]);
  });
});

describe('getFields', () => {
  it("offers the selected table's fields as options", async () => {
    const { ctx, http } = ctxFor([ok([{ id: 'f1', FieldName: 'ShortDescription' }])], { tableName: 'Incident' });

    await expect(getFields.call(ctx as ILoadOptionsFunctions)).resolves.toEqual([
      { name: 'ShortDescription', value: 'ShortDescription' },
    ]);
    expect(http.calls[0].options.qs?.query).toBe(
      JSON.stringify({ and: [{ fieldName: 'Table', operator: '=', value: 'Incident' }] }),
    );
  });

  it('offers nothing until a table is selected', async () => {
    const { ctx, http } = ctxFor([ok([])]);

    await expect(getFields.call(ctx as ILoadOptionsFunctions)).resolves.toEqual([]);
    expect(http.count()).toBe(0);
  });
});

describe('record pickers', () => {
  it('labels records by the first populated label field', async () => {
    const { ctx, http } = ctxFor([ok([{ id: 'r1', Number: 'INC001' }])], { tableName: 'Incident' });

    const result = await searchObjectRecords.call(ctx as ILoadOptionsFunctions);

    expect(http.calls[0].options.url).toBe('/v1/Incident');
    expect(http.calls[0].options.qs).toEqual({ page: 1, page_size: 100 });
    expect(result.results).toEqual([{ name: 'INC001', value: 'r1' }]);
  });

  it('unwraps a displayValue object as the label', async () => {
    const { ctx } = ctxFor([ok([{ id: 'r1', Name: { value: 'g1', displayValue: 'Service Desk' } }])], {
      tableName: 'Incident',
    });

    const result = await searchObjectRecords.call(ctx as ILoadOptionsFunctions);

    expect(result.results).toEqual([{ name: 'Service Desk', value: 'r1' }]);
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

    expect(result.results).toEqual([{ name: 'INC002', value: 'xyz' }]);
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
    expect(result.results).toEqual([{ name: 'x.png', value: 'a1' }]);
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
      { name: 'Incident Queue', value: 'incident-queue' },
      { name: 'bare-queue', value: 'bare-queue' },
    ]);
  });
});

describe('picker pagination', () => {
  it('hands back a token for the next page when the page came back full', async () => {
    const { ctx } = ctxFor([ok(fullPage(PICKER_PAGE_SIZE))], { tableName: 'Incident' });

    const result = await searchObjectRecords.call(ctx as ILoadOptionsFunctions);

    expect(result.results).toHaveLength(PICKER_PAGE_SIZE);
    expect(result.paginationToken).toBe('2');
  });

  it('omits the token once a short page ends the table', async () => {
    const { ctx } = ctxFor([ok(fullPage(PICKER_PAGE_SIZE - 1))], { tableName: 'Incident' });

    const result = await searchObjectRecords.call(ctx as ILoadOptionsFunctions);

    expect(result.paginationToken).toBeUndefined();
  });

  it('requests the page the token names and advances it', async () => {
    const { ctx, http } = ctxFor([ok(fullPage(PICKER_PAGE_SIZE))], { tableName: 'Incident' });

    const result = await searchObjectRecords.call(ctx as ILoadOptionsFunctions, undefined, '3');

    expect(http.calls[0].options.qs).toEqual({ page: 3, page_size: PICKER_PAGE_SIZE });
    expect(result.paginationToken).toBe('4');
  });

  it('keeps paging when a filter empties a full page', async () => {
    const { ctx } = ctxFor([ok(fullPage(PICKER_PAGE_SIZE))], { tableName: 'Incident' });

    const result = await searchObjectRecords.call(ctx as ILoadOptionsFunctions, 'no-such-record');

    expect(result.results).toEqual([]);
    expect(result.paginationToken).toBe('2');
  });

  it('restarts at page 1 on a token it cannot read', async () => {
    const { ctx, http } = ctxFor([ok([{ id: 'r1' }])], { tableName: 'Incident' });

    await searchObjectRecords.call(ctx as ILoadOptionsFunctions, undefined, 'not-a-page');

    expect(http.calls[0].options.qs).toMatchObject({ page: 1 });
  });

  it('paginates the queue, action, and controller pickers too', async () => {
    const queues = ctxFor([ok(fullPage(PICKER_PAGE_SIZE).map((r) => ({ ...r, ConnectionString: r.id })))]);
    await expect(searchQueues.call(queues.ctx as ILoadOptionsFunctions, undefined, '2')).resolves.toMatchObject({
      paginationToken: '3',
    });
    expect(queues.http.calls[0].options.qs).toMatchObject({ page: 2, page_size: PICKER_PAGE_SIZE });

    const actions = ctxFor(
      [ok([{ id: 'p1' }]), ok(fullPage(PICKER_PAGE_SIZE).map((r) => ({ ...r, Command: r.id })))],
      { queue: 'q' },
    );
    await expect(searchActions.call(actions.ctx as ILoadOptionsFunctions, undefined, '2')).resolves.toMatchObject({
      paginationToken: '3',
    });
    expect(actions.http.calls[1].options.qs).toMatchObject({ page: 2, page_size: PICKER_PAGE_SIZE });

    const controllers = ctxFor([ok(fullPage(PICKER_PAGE_SIZE))]);
    await expect(
      searchControllers.call(controllers.ctx as ILoadOptionsFunctions, undefined, '2'),
    ).resolves.toMatchObject({ paginationToken: '3' });
    expect(controllers.http.calls[0].options.qs).toMatchObject({ page: 2, page_size: PICKER_PAGE_SIZE });
  });
});

describe('discovery pagination', () => {
  /** Answer TableDefinition per page; every other table is empty. */
  function discoveryCtx(tableDefinition: (page: number) => HttpStep) {
    const http = makeRoutedHttpStub((url, page) =>
      url === '/v1/TableDefinition' ? tableDefinition(page) : ok([]),
    );
    return ctxWith(http);
  }

  /** A full registry page, so paging continues. */
  function registryPage(page: number) {
    return Array.from({ length: DISCOVERY_PAGE_SIZE }, (_, i) => ({ id: `T${page}-${i}`, Table: `T${page}-${i}` }));
  }

  it('pages the registry to the end instead of stopping at one page', async () => {
    const { ctx, http } = discoveryCtx((page) =>
      page === 1 ? ok(registryPage(1)) : ok([{ id: 'ZLastTable', Table: 'ZLastTable' }]),
    );

    const tables = await discoverTables(ctx);

    expect(tables).toHaveLength(DISCOVERY_PAGE_SIZE + 1);
    expect(tables).toContainEqual({ name: 'ZLastTable', value: 'ZLastTable' });
    expect(http.calls.filter((call) => call.options.url === '/v1/TableDefinition')).toHaveLength(2);
  });

  it('keeps the pages it already has when a later page fails', async () => {
    const { ctx } = discoveryCtx((page) => (page === 1 ? ok(registryPage(1)) : { throw: 'connection reset' }));

    await expect(discoverTables(ctx)).resolves.toHaveLength(DISCOVERY_PAGE_SIZE);
  });

  it('stops at the page ceiling when the registry never returns a short page', async () => {
    const { ctx, http } = discoveryCtx((page) => ok(registryPage(page)));

    await discoverTables(ctx);

    // MAX_DISCOVERY_PAGES, rather than looping until the instance runs dry.
    expect(http.calls.filter((call) => call.options.url === '/v1/TableDefinition')).toHaveLength(10);
  });
});

describe('searchControllers', () => {
  it('lists SystemController records keyed by Name, labelled and sorted', async () => {
    const { ctx, http } = ctxFor([
      ok([
        { id: 'c1', Name: 'MyController' },
        { id: 'c2', Name: 'AsyncIntegration', Label: 'Async Integration' },
        { id: 'c3', ClassName: 'LegacyController' },
        { id: 'c4', Description: 'no name at all' },
      ]),
    ]);

    const result = await searchControllers.call(ctx as ILoadOptionsFunctions);

    expect(http.calls[0].options.url).toBe('/v1/SystemController');
    // CONTROLLER_LABEL_FIELDS is just ['Name'], so a Label field is ignored and
    // every entry collapses to its bare name.
    expect(result.results).toEqual([
      { name: 'AsyncIntegration', value: 'AsyncIntegration' },
      { name: 'LegacyController', value: 'LegacyController' },
      { name: 'MyController', value: 'MyController' },
    ]);
  });

  it('filters on the name', async () => {
    const { ctx } = ctxFor([
      ok([
        { id: 'c1', Name: 'AsyncIntegration' },
        { id: 'c2', Name: 'MyController' },
      ]),
    ]);

    const result = await searchControllers.call(ctx as ILoadOptionsFunctions, 'async');

    expect(result.results).toEqual([{ name: 'AsyncIntegration', value: 'AsyncIntegration' }]);
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
    expect(result.results).toEqual([{ name: 'Process', value: 'process-incident' }]);
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
