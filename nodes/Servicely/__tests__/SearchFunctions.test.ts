import type { ILoadOptionsFunctions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

/**
 * A picker entry for a record with no label field: both halves are the id. Built
 * rather than written out, because n8n's node-param rules read a `name` holding a
 * string literal as a display name and ask for it in Title Case.
 */
const idOnlyItem = (id: string) => ({ name: id, value: id });

import {
  discoverFields,
  discoverTables,
  getAiAgents,
  getAiAssistants,
  getFields,
  getRoles,
  listSearchMethods,
  searchActions,
  searchControllers,
  searchFields,
  searchGlobalSearchTables,
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
      'searchControllers',
      'searchFields',
      'searchGlobalSearchTables',
      'searchParentRecords',
      'searchQueues',
      'searchTables',
    ]);
  });

  it('exposes every loadOptions method the descriptions reference', () => {
    expect(Object.keys(listSearchMethods.loadOptions).sort()).toEqual([
      'getAiAgents',
      'getAiAssistants',
      'getFields',
      'getRoles',
    ]);
  });
});

describe('discoverTables', () => {
  it('reads TableDefinition, labelling by the API table name and storing the row id', async () => {
    const { ctx, http } = ctxFor([
      ok([
        { id: 'guid-1', Table: 'Incident' },
        { id: 'guid-2', Table: 'ITSMRequest' },
      ]),
    ]);

    const tables = await discoverTables(ctx);

    expect(http.calls[0].options.url).toBe('/v1/TableDefinition');
    expect(http.calls[0].options.qs).toEqual({ page: 1, page_size: DISCOVERY_PAGE_SIZE });
    // The id is what FieldDefinition references; the name reaches the operations
    // as the locator's cached label (see locatorLabel).
    expect(tables).toEqual([
      { name: 'Incident', value: 'guid-1' },
      { name: 'ITSMRequest', value: 'guid-2' },
    ]);
  });

  it('sorts by name and dedupes repeated names', async () => {
    const { ctx } = ctxFor([
      ok([
        { id: 'guid-1', Table: 'Zulu' },
        { id: 'guid-2', Table: 'Alpha' },
        { id: 'guid-3', Table: 'Zulu' },
      ]),
    ]);

    await expect(discoverTables(ctx)).resolves.toEqual([
      { name: 'Alpha', value: 'guid-2' },
      { name: 'Zulu', value: 'guid-1' },
    ]);
  });

  it('skips rows with no usable table name', async () => {
    const { ctx } = ctxFor([ok([{ id: 'guid-1', Table: '  ' }, { id: 'guid-2' }, { id: 'guid-3', Table: 'Incident' }])]);

    await expect(discoverTables(ctx)).resolves.toEqual([{ name: 'Incident', value: 'guid-3' }]);
  });

  it('falls back to the table name when a registry row carries no id', async () => {
    const { ctx } = ctxFor([ok([{ Table: 'Incident' }])]);

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
        { id: 'guid-1', Table: 'Incident' },
        { id: 'guid-2', Table: 'Change' },
      ]),
    ]);

    const result = await searchTables.call(ctx as ILoadOptionsFunctions, 'inc');

    expect(result.results).toEqual([{ name: 'Incident', value: 'guid-1' }]);
  });
});

describe('discoverFields', () => {
  // The table locator hands over the TableDefinition row id, which is what
  // FieldDefinition references — so the fields are one query, with no name → id
  // lookup in front of it.
  it('keys FieldDefinition rows by FieldName, queried by the table it is given', async () => {
    const { ctx, http } = ctxFor([
      ok([
        { id: 'f1', FieldName: 'State' },
        { id: 'f2', FieldName: 'AssignmentGroup' },
      ]),
    ]);

    const fields = await discoverFields(ctx, 'guid-1');

    expect(http.count()).toBe(1);
    expect(http.calls[0].options.url).toBe('/v1/FieldDefinition');
    expect(http.calls[0].options.qs).toEqual({
      page: 1,
      page_size: DISCOVERY_PAGE_SIZE,
      query: JSON.stringify({ and: [{ fieldName: 'Table', operator: '=', value: 'guid-1' }] }),
    });
    expect(fields).toEqual([
      { name: 'AssignmentGroup', value: 'AssignmentGroup' },
      { name: 'State', value: 'State' },
    ]);
  });

  it('dedupes names and skips rows with no usable FieldName', async () => {
    const { ctx } = ctxFor([
      ok([
        { id: 'f1', FieldName: 'State' },
        { id: 'f2', FieldName: 'State' },
        { id: 'f3', FieldName: '  ' },
        { id: 'f4', Label: 'no name' },
      ]),
    ]);

    await expect(discoverFields(ctx, 'guid-1')).resolves.toEqual([{ name: 'State', value: 'State' }]);
  });

  it('makes no request when no table is given', async () => {
    const { ctx, http } = ctxFor([ok([])]);

    await expect(discoverFields(ctx, '')).resolves.toEqual([]);
    expect(http.count()).toBe(0);
  });

  it('offers nothing for a table the field registry does not know', async () => {
    const { ctx, http } = ctxFor([ok([])]);

    await expect(discoverFields(ctx, 'guid-nope')).resolves.toEqual([]);
    expect(http.count()).toBe(1);
  });

  it('returns an empty list when the registry does not respond', async () => {
    await expect(discoverFields(ctxFor([{ status: 404, body: {} }]).ctx, 'guid-1')).resolves.toEqual([]);
  });
});

describe('searchFields', () => {
  it("offers the selected table's fields", async () => {
    const { ctx, http } = ctxFor([ok([{ id: 'f1', FieldName: 'ShortDescription' }])], {
      tableName: 'guid-1',
    });

    await expect(searchFields.call(ctx as ILoadOptionsFunctions)).resolves.toEqual({
      results: [{ name: 'ShortDescription', value: 'ShortDescription' }],
    });
    // Queried by what the table locator stores, straight through
    expect(http.calls[0].options.qs?.query).toBe(
      JSON.stringify({ and: [{ fieldName: 'Table', operator: '=', value: 'guid-1' }] }),
    );
  });

  it('filters the field names client-side', async () => {
    const { ctx } = ctxFor(
      [ok([{ id: 'f1', FieldName: 'State' }, { id: 'f2', FieldName: 'ShortDescription' }])],
      { tableName: 'guid-1' },
    );

    await expect(searchFields.call(ctx as ILoadOptionsFunctions, 'desc')).resolves.toEqual({
      results: [{ name: 'ShortDescription', value: 'ShortDescription' }],
    });
  });

  it('offers nothing until a table is selected', async () => {
    const { ctx, http } = ctxFor([ok([])]);

    await expect(searchFields.call(ctx as ILoadOptionsFunctions)).resolves.toEqual({ results: [] });
    expect(http.count()).toBe(0);
  });
});

describe('getFields', () => {
  /** Answers by URL, so the assertion holds however `discoverFields` reaches the registry. */
  function registryCtx(params: ParamMap) {
    return ctxWith(
      makeRoutedHttpStub((url) =>
        url.includes('FieldDefinition')
          ? ok([{ id: 'f1', FieldName: 'State' }, { id: 'f2', FieldName: 'AssignmentGroup' }])
          : ok([{ id: 'guid-1', Table: 'Incident' }]),
      ),
      params,
    );
  }

  it("offers the selected table's fields as dropdown options", async () => {
    const { ctx } = registryCtx({ tableName: 'Incident' });

    await expect(getFields.call(ctx as ILoadOptionsFunctions)).resolves.toEqual([
      { name: 'AssignmentGroup', value: 'AssignmentGroup' },
      { name: 'State', value: 'State' },
    ]);
  });

  it('offers nothing until a table is selected', async () => {
    const { ctx, http } = ctxFor([ok([])]);

    await expect(getFields.call(ctx as ILoadOptionsFunctions)).resolves.toEqual([]);
    expect(http.count()).toBe(0);
  });
});

describe('getAiAgents', () => {
  it('reads SystemAIAgent, labelling by Name and storing the row id, sorted', async () => {
    const { ctx, http } = ctxFor([
      ok([
        { id: 'a1', Name: 'Service Desk Agent' },
        { id: 'a2', Name: 'Approvals Agent' },
      ]),
    ]);

    await expect(getAiAgents.call(ctx as ILoadOptionsFunctions)).resolves.toEqual([
      { name: 'Approvals Agent', value: 'a2' },
      { name: 'Service Desk Agent', value: 'a1' },
    ]);
    expect(http.calls[0].options.url).toBe('/v1/SystemAIAgent');
    expect(http.calls[0].options.qs).toEqual({ page: 1, page_size: DISCOVERY_PAGE_SIZE });
  });

  it('dedupes repeated ids and falls back to the id when a row has no name', async () => {
    const { ctx } = ctxFor([
      ok([
        { id: 'a1' },
        { id: 'a1', Name: 'Second Approvals' },
      ]),
    ]);

    await expect(getAiAgents.call(ctx as ILoadOptionsFunctions)).resolves.toEqual([
      idOnlyItem('a1'),
    ]);
  });

  it('skips rows without an id', async () => {
    const { ctx } = ctxFor([ok([{ Name: 'Idless' }, { id: 'a2', Name: 'Ok' }])]);

    await expect(getAiAgents.call(ctx as ILoadOptionsFunctions)).resolves.toEqual([
      { name: 'Ok', value: 'a2' },
    ]);
  });

  it('leaves the list empty when the table cannot be read', async () => {
    const { ctx } = ctxFor([{ status: 500, body: { message: 'boom' } }]);

    await expect(getAiAgents.call(ctx as ILoadOptionsFunctions)).resolves.toEqual([]);
  });
});

// The assistant registry is read exactly as the agent one is, from its own table.
describe('getAiAssistants', () => {
  it('reads SystemAIAssistant, labelling by Name and storing the row id, sorted', async () => {
    const { ctx, http } = ctxFor([
      ok([
        { id: 's1', Name: 'Service Desk Assistant' },
        { id: 's2', Name: 'Approvals Assistant' },
      ]),
    ]);

    await expect(getAiAssistants.call(ctx as ILoadOptionsFunctions)).resolves.toEqual([
      { name: 'Approvals Assistant', value: 's2' },
      { name: 'Service Desk Assistant', value: 's1' },
    ]);
    expect(http.calls[0].options.url).toBe('/v1/SystemAIAssistant');
    expect(http.calls[0].options.qs).toEqual({ page: 1, page_size: DISCOVERY_PAGE_SIZE });
  });

  it('leaves the list empty on an instance without the table', async () => {
    const { ctx } = ctxFor([{ status: 404, body: {} }]);

    await expect(getAiAssistants.call(ctx as ILoadOptionsFunctions)).resolves.toEqual([]);
  });
});

// A tool's roles are stored the way its agents are — record ids — so the picker is
// the same read against the role table.
describe('getRoles', () => {
  it('reads Role, labelling by Name and storing the row id, sorted', async () => {
    const { ctx, http } = ctxFor([
      ok([
        { id: 'r1', Name: 'Service Desk' },
        { id: 'r2', Name: 'Approver' },
      ]),
    ]);

    await expect(getRoles.call(ctx as ILoadOptionsFunctions)).resolves.toEqual([
      { name: 'Approver', value: 'r2' },
      { name: 'Service Desk', value: 'r1' },
    ]);
    expect(http.calls[0].options.url).toBe('/v1/Role');
    expect(http.calls[0].options.qs).toEqual({ page: 1, page_size: DISCOVERY_PAGE_SIZE });
  });

  it('leaves the list empty on an instance without the table', async () => {
    const { ctx } = ctxFor([{ status: 404, body: {} }]);

    await expect(getRoles.call(ctx as ILoadOptionsFunctions)).resolves.toEqual([]);
  });
});

describe('record pickers', () => {
  it('labels records by the first populated label field', async () => {
    const { ctx, http } = ctxFor([ok([{ id: 'r1', Number: 'INC001' }])], { parentTable: 'Incident' });

    const result = await searchParentRecords.call(ctx as ILoadOptionsFunctions);

    expect(http.calls[0].options.url).toBe('/v1/Incident');
    expect(http.calls[0].options.qs).toEqual({ page: 1, page_size: 100 });
    expect(result.results).toEqual([{ name: 'INC001', value: 'r1' }]);
  });

  it('unwraps a displayValue object as the label', async () => {
    const { ctx } = ctxFor([ok([{ id: 'r1', Name: { value: 'g1', displayValue: 'Service Desk' } }])], {
      parentTable: 'Incident',
    });

    const result = await searchParentRecords.call(ctx as ILoadOptionsFunctions);

    expect(result.results).toEqual([{ name: 'Service Desk', value: 'r1' }]);
  });

  it('falls back to the id when no label field is populated', async () => {
    const { ctx } = ctxFor([ok([{ id: 'r1', State: 'Open' }])], { parentTable: 'Incident' });

    const result = await searchParentRecords.call(ctx as ILoadOptionsFunctions);

    expect(result.results).toEqual([idOnlyItem('r1')]);
  });

  it('filters on the value as well as the label', async () => {
    const { ctx } = ctxFor([ok([{ id: 'abc', Number: 'INC001' }, { id: 'xyz', Number: 'INC002' }])], {
      parentTable: 'Incident',
    });

    const result = await searchParentRecords.call(ctx as ILoadOptionsFunctions, 'XY');

    expect(result.results).toEqual([{ name: 'INC002', value: 'xyz' }]);
  });

  it('returns nothing when no table is selected yet', async () => {
    const { ctx, http } = ctxFor([ok([])]);

    await expect(searchParentRecords.call(ctx as ILoadOptionsFunctions)).resolves.toEqual({ results: [] });
    expect(http.count()).toBe(0);
  });

  it('reads the Attachment resource parent table', async () => {
    const { ctx, http } = ctxFor([ok([{ id: 'r1' }])], { parentTable: 'Change' });

    await searchParentRecords.call(ctx as ILoadOptionsFunctions);

    expect(http.calls[0].options.url).toBe('/v1/Change');
  });

  it('labels a record by its FileName when that is the field it carries', async () => {
    const { ctx } = ctxFor([ok([{ id: 'a1', FileName: 'x.png' }])], { parentTable: 'Attachment' });

    const result = await searchParentRecords.call(ctx as ILoadOptionsFunctions);

    expect(result.results).toEqual([{ name: 'x.png', value: 'a1' }]);
  });
});

describe('searchGlobalSearchTables', () => {
  it("asks the controller for its config and offers each entry's table", async () => {
    const { ctx, http } = ctxFor([
      ok([
        { id: '1', table: 'Incident' },
        { id: '2', table: 'Asset' },
        { id: '3', table: 'Incident' },
        { id: '4' },
      ]),
    ]);

    const result = await searchGlobalSearchTables.call(ctx as ILoadOptionsFunctions);

    expect(http.calls[0].options.method).toBe('POST');
    expect(http.calls[0].options.url).toBe('/controller/GlobalSearch');
    expect(http.calls[0].options.body).toEqual({ request_type: 'search_config' });
    // Deduped, sorted, entries without a table skipped, and the id never stored.
    expect(result.results).toEqual([
      { name: 'Asset', value: 'Asset' },
      { name: 'Incident', value: 'Incident' },
    ]);
    // The whole config arrives in one response, so there is nothing to page.
    expect(result.paginationToken).toBeUndefined();
    expect(http.count()).toBe(1);
  });

  it('filters the configured tables client-side', async () => {
    const { ctx } = ctxFor([ok([{ id: '1', table: 'Incident' }, { id: '2', table: 'Asset' }])]);

    await expect(searchGlobalSearchTables.call(ctx as ILoadOptionsFunctions, 'inc')).resolves.toEqual({
      results: [{ name: 'Incident', value: 'Incident' }],
    });
  });

  it('surfaces a controller that does not answer', async () => {
    const { ctx } = ctxFor([{ status: 404, body: {} }]);

    await expect(searchGlobalSearchTables.call(ctx as ILoadOptionsFunctions)).rejects.toThrow();
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
    const { ctx } = ctxFor([ok(fullPage(PICKER_PAGE_SIZE))], { parentTable: 'Incident' });

    const result = await searchParentRecords.call(ctx as ILoadOptionsFunctions);

    expect(result.results).toHaveLength(PICKER_PAGE_SIZE);
    expect(result.paginationToken).toBe('2');
  });

  it('omits the token once a short page ends the table', async () => {
    const { ctx } = ctxFor([ok(fullPage(PICKER_PAGE_SIZE - 1))], { parentTable: 'Incident' });

    const result = await searchParentRecords.call(ctx as ILoadOptionsFunctions);

    expect(result.paginationToken).toBeUndefined();
  });

  it('requests the page the token names and advances it', async () => {
    const { ctx, http } = ctxFor([ok(fullPage(PICKER_PAGE_SIZE))], { parentTable: 'Incident' });

    const result = await searchParentRecords.call(ctx as ILoadOptionsFunctions, undefined, '3');

    expect(http.calls[0].options.qs).toEqual({ page: 3, page_size: PICKER_PAGE_SIZE });
    expect(result.paginationToken).toBe('4');
  });

  it('keeps paging when a filter empties a full page', async () => {
    const { ctx } = ctxFor([ok(fullPage(PICKER_PAGE_SIZE))], { parentTable: 'Incident' });

    const result = await searchParentRecords.call(ctx as ILoadOptionsFunctions, 'no-such-record');

    expect(result.results).toEqual([]);
    expect(result.paginationToken).toBe('2');
  });

  it('restarts at page 1 on a token it cannot read', async () => {
    const { ctx, http } = ctxFor([ok([{ id: 'r1' }])], { parentTable: 'Incident' });

    await searchParentRecords.call(ctx as ILoadOptionsFunctions, undefined, 'not-a-page');

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
