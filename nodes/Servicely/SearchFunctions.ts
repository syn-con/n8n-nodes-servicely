import type { IDataObject, ILoadOptionsFunctions, INodeListSearchItems, INodeListSearchResult } from 'n8n-workflow';

import { CONTROLLER_TABLE } from './constants';
import { servicelyApiRequest, toRecordList } from './GenericFunctions';
import type { BatchRequest, BatchResponse, ServicelyRecord } from './types';

/**
 * `methods.listSearch` implementations backing the "From List" mode of every
 * resourceLocator: the Table and Record pickers on the Servicely node, and the
 * Queue / Action Name pickers on the trigger.
 *
 * Every searchable picker is paginated: n8n calls the method with the
 * `paginationToken` from the previous result once the user scrolls past the
 * loaded entries, so a table with more records than one page still browses to
 * the end. The token is simply the next page number — Servicely's list
 * endpoints are offset-based (`page` / `page_size`) and expose no cursor.
 */

/** How many records one picker page fetches. */
const SEARCH_PAGE_SIZE = 100;

/** Fields tried, in order, to derive a human-readable label for a record. */
const LABEL_FIELDS = ['Number', 'Name', 'Title', 'ShortDescription', 'FileName', 'DisplayName', 'Email', 'Label'];

/** Fields tried, in order, for a controller's display label (its Name is the fallback). */
const CONTROLLER_LABEL_FIELDS = ['Label', 'Title', 'Description'];

/** Async Integration lookups: the provider table, action table, and connection-type filter. */
const QUEUE_TABLE = 'ActionProviderInstance';
const ACTION_TABLE = 'Action';
const ASYNC_CONNECTION_TYPE = 'async_integration';

/** Fetch one page of a table, optionally filtered by a complex query. */
async function listRecords(
  ctx: ILoadOptionsFunctions,
  table: string,
  query?: IDataObject,
  pageSize = SEARCH_PAGE_SIZE,
  page = 1,
): Promise<ServicelyRecord[]> {
  const qs: IDataObject = { page, page_size: pageSize };
  if (query) {
    qs.query = JSON.stringify(query);
  }
  return toRecordList<ServicelyRecord>(await servicelyApiRequest.call(ctx, 'GET', `/v1/${table}`, undefined, qs));
}

/** 1-indexed page a picker request is asking for; anything unparsable restarts at 1. */
function pageFrom(paginationToken?: string): number {
  const page = Number.parseInt(paginationToken ?? '', 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

/**
 * One picker page: the items to show, plus the token for the page after it.
 *
 * The token is decided by how many records the API returned (a full page means
 * there may be more), never by how many survived filtering — a filter can empty
 * a page whose successors still hold matches, and dropping the token there would
 * strand them.
 */
function pickerPage(results: INodeListSearchItems[], page: number, fetched: number): INodeListSearchResult {
  return fetched < SEARCH_PAGE_SIZE ? { results } : { results, paginationToken: String(page + 1) };
}

/** Case-insensitive filter over a search item's name and value. */
function matchesFilter(item: INodeListSearchItems, filter?: string): boolean {
  if (!filter) {
    return true;
  }
  const needle = filter.toLowerCase();
  return item.name.toLowerCase().includes(needle) || String(item.value).toLowerCase().includes(needle);
}

/** Read a resourceLocator parameter's extracted value (empty string if unset). */
function readLocatorValue(ctx: ILoadOptionsFunctions, name: string): string {
  return String(ctx.getNodeParameter(name, '', { extractValue: true }) ?? '').trim();
}

/** Read a string field off a record, treating empty/non-string as absent. */
function fieldString(record: ServicelyRecord, field: string): string | undefined {
  const value = record[field];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** Best-effort display label for a record, falling back to its id. */
function recordLabel(record: ServicelyRecord): string {
  for (const field of LABEL_FIELDS) {
    const value = record[field];
    if (typeof value === 'string' && value.trim() !== '') {
      return value;
    }
    if (value && typeof value === 'object' && typeof (value as { displayValue?: unknown }).displayValue === 'string') {
      return (value as { displayValue: string }).displayValue;
    }
  }
  return String(record.id);
}

/** `Label (value)`, collapsing to just the value when there is no distinct label. */
function searchItem(label: string, value: string): INodeListSearchItems {
  return { name: label === value ? value : `${label} (${value})`, value };
}

/**
 * Fetch one page of a table as search items, filtered client-side (the REST API
 * has no generic text-search parameter). Filtering per page rather than
 * server-side is why the token keeps flowing while pages remain: n8n asks for
 * the next one as the user scrolls, so matches deeper in the table still arrive.
 */
async function searchRecordsInTable(
  ctx: ILoadOptionsFunctions,
  table: string,
  filter?: string,
  paginationToken?: string,
): Promise<INodeListSearchResult> {
  if (!table) {
    return { results: [] };
  }
  const page = pageFrom(paginationToken);
  const records = await listRecords(ctx, table, undefined, SEARCH_PAGE_SIZE, page);
  const results = records
    .map((record) => searchItem(recordLabel(record), String(record.id)))
    .filter((item) => matchesFilter(item, filter));
  return pickerPage(results, page, records.length);
}

// ---------------------------------------------------------------------------
// Table discovery
// ---------------------------------------------------------------------------

/**
 * Servicely's REST API exposes no master table-registry endpoint (no Swagger,
 * and generic "metadata"/"entity" probes return unrelated rows — e.g. `Entity`
 * is a named-pattern store). Instead, table names are gathered at runtime from
 * documented metadata tables whose rows reference real leaf tables, verified
 * against a live instance:
 *
 *  - `SequenceNumber` — one row per numbered table; its `Table` field holds the
 *    exact PascalCase table name (Incident, Change, Problem, Asset, and custom
 *    "C_"/"AD_"-prefixed tables). This is the primary, confirmed source.
 *  - `cmdbmetadata`   — the CMDB class registry.
 *
 * Each source is best-effort and casing-robust (both the scripting lowercase and
 * REST PascalCase spellings are tried, field names match case-insensitively).
 * Anything not covered stays reachable via the resourceLocator "By Name" mode.
 */
const TABLE_SOURCES: ReadonlyArray<{ table: string; field: string }> = [
  { table: 'SequenceNumber', field: 'table' },
  { table: 'cmdbmetadata', field: 'name' },
];

/** Numbering/CMDB registries are small, so discovery reads them in large pages. */
const DISCOVERY_PAGE_SIZE = 2000;

/**
 * Ceiling on discovery paging. The Table picker loads its whole list in one go
 * (it is not `searchable`, so n8n filters client-side and never asks for a
 * second page), which means the paging happens here — and design-time work has
 * to stay bounded even if a metadata table turns out to be unexpectedly large.
 */
const MAX_DISCOVERY_PAGES = 10;

/** Non-empty string value whose (lowercased) key matches `field`. */
function valueForKey(row: ServicelyRecord, field: string): string | undefined {
  const wanted = field.toLowerCase();
  const key = Object.keys(row).find((candidate) => candidate.toLowerCase() === wanted);
  const value = key === undefined ? undefined : row[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * Every row of a metadata table, paged to the end (or to MAX_DISCOVERY_PAGES).
 * A failure on the first page propagates, so the caller can treat it as "this
 * table/casing does not answer"; a failure once rows are in hand keeps the
 * partial read instead, discovery being best-effort by design.
 */
async function allRows(ctx: ILoadOptionsFunctions, table: string, pageSize: number): Promise<ServicelyRecord[]> {
  const rows: ServicelyRecord[] = [];

  /* eslint-disable no-await-in-loop -- pagination is inherently sequential */
  for (let page = 1; page <= MAX_DISCOVERY_PAGES; page++) {
    let batch: ServicelyRecord[];
    try {
      batch = await listRecords(ctx, table, undefined, pageSize, page);
    } catch (error) {
      if (page === 1) {
        throw error;
      }
      return rows;
    }
    rows.push(...batch);
    if (batch.length < pageSize) {
      return rows;
    }
  }
  /* eslint-enable no-await-in-loop */

  return rows;
}

/** Read `field` off every row of a metadata table, trying name casings, tolerating errors. */
async function namesFrom(ctx: ILoadOptionsFunctions, table: string, field: string): Promise<string[]> {
  const pascal = table.charAt(0).toUpperCase() + table.slice(1);
  for (const name of new Set([table, pascal])) {
    try {
      // eslint-disable-next-line no-await-in-loop -- casings are tried in order until one responds
      const rows = await allRows(ctx, name, DISCOVERY_PAGE_SIZE);
      const names = rows.map((row) => valueForKey(row, field)).filter((value): value is string => value !== undefined);
      if (names.length > 0) {
        return names;
      }
    } catch {
      // this casing is absent/forbidden; try the next
    }
  }
  return [];
}

/**
 * Metadata sources can name tables that aren't actually queryable (e.g. rows left
 * behind by uninstalled apps — `CalendarEvent` 404s). One `_batch` probes every
 * candidate; only names whose sub-response is an explicit error (>= 400) are
 * dropped. If batch is unavailable the candidates are kept unfiltered (better a
 * superset than an empty list).
 */
async function dropMissingTables(ctx: ILoadOptionsFunctions, names: string[]): Promise<string[]> {
  if (names.length === 0) {
    return names;
  }
  const requests: BatchRequest[] = names.map((table, index) => ({
    id: String(index + 1),
    method: 'GET',
    url: `/v1/${table}?page_size=1`,
    body: null,
  }));

  try {
    const response = (await servicelyApiRequest.call(ctx, 'POST', '/v1/_batch', {
      id: `n8n-batch-${Date.now()}`,
      requests: requests as unknown as IDataObject[],
    })) as BatchResponse;

    const missing = new Set<string>();
    for (const subResponse of response.requests ?? []) {
      const name = names[Number(subResponse.id) - 1];
      if (name !== undefined && subResponse.status_code >= 400) {
        missing.add(name);
      }
    }
    return names.filter((name) => !missing.has(name));
  } catch {
    return names;
  }
}

/** Discover instance table names from confirmed metadata sources (validated, deduped, sorted). */
export async function discoverTables(ctx: ILoadOptionsFunctions): Promise<string[]> {
  const perSource = await Promise.all(TABLE_SOURCES.map((source) => namesFrom(ctx, source.table, source.field)));

  const byKey = new Map<string, string>();
  for (const name of perSource.flat()) {
    const key = name.toLowerCase();
    if (!byKey.has(key)) {
      byKey.set(key, name);
    }
  }

  const existing = await dropMissingTables(ctx, [...byKey.values()]);
  return existing.sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// listSearch methods
// ---------------------------------------------------------------------------

/** Table names discovered dynamically from the instance (Table picker). */
export async function searchTables(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
  const tables = await discoverTables(this);
  const results = tables.map((table) => ({ name: table, value: table })).filter((item) => matchesFilter(item, filter));
  return { results };
}

/** Records of the Object resource's selected `tableName`. */
export async function searchObjectRecords(
  this: ILoadOptionsFunctions,
  filter?: string,
  paginationToken?: string,
): Promise<INodeListSearchResult> {
  return searchRecordsInTable(this, readLocatorValue(this, 'tableName'), filter, paginationToken);
}

/** Records of the Attachment resource's `parentTable`. */
export async function searchParentRecords(
  this: ILoadOptionsFunctions,
  filter?: string,
  paginationToken?: string,
): Promise<INodeListSearchResult> {
  return searchRecordsInTable(this, readLocatorValue(this, 'parentTable'), filter, paginationToken);
}

/** Records of the `Attachment` table (Attachment picker). */
export async function searchAttachments(
  this: ILoadOptionsFunctions,
  filter?: string,
  paginationToken?: string,
): Promise<INodeListSearchResult> {
  return searchRecordsInTable(this, 'Attachment', filter, paginationToken);
}

/**
 * Async-integration queues, i.e. `ActionProviderInstance` records whose
 * `ConnectionType` is `async_integration`. The stored value is the record's
 * `ConnectionString` (the queue identifier used when dequeuing).
 */
export async function searchQueues(
  this: ILoadOptionsFunctions,
  filter?: string,
  paginationToken?: string,
): Promise<INodeListSearchResult> {
  const page = pageFrom(paginationToken);
  const records = await listRecords(
    this,
    QUEUE_TABLE,
    { and: [{ fieldName: 'ConnectionType', operator: '=', value: ASYNC_CONNECTION_TYPE }] },
    SEARCH_PAGE_SIZE,
    page,
  );

  const results = records
    .map((record) => {
      const connectionString = fieldString(record, 'ConnectionString');
      return connectionString ? searchItem(fieldString(record, 'Name') ?? connectionString, connectionString) : null;
    })
    .filter((item): item is INodeListSearchItems => item !== null)
    .filter((item) => matchesFilter(item, filter));

  return pickerPage(results, page, records.length);
}

/**
 * `Action` records belonging to the selected queue's provider instance. Resolves
 * the ProviderInstance id from the chosen queue's ConnectionString, then lists
 * Actions filtered by `ProviderInstance`; the stored value is each Action's
 * `Command`.
 */
export async function searchActions(
  this: ILoadOptionsFunctions,
  filter?: string,
  paginationToken?: string,
): Promise<INodeListSearchResult> {
  const queueValue = readLocatorValue(this, 'queue');
  if (!queueValue) {
    return { results: [] };
  }

  const providerInstances = await listRecords(
    this,
    QUEUE_TABLE,
    {
      and: [
        { fieldName: 'ConnectionType', operator: '=', value: ASYNC_CONNECTION_TYPE },
        { fieldName: 'ConnectionString', operator: '=', value: queueValue },
      ],
    },
    1,
  );
  if (!providerInstances[0]) {
    return { results: [] };
  }

  const page = pageFrom(paginationToken);
  const records = await listRecords(
    this,
    ACTION_TABLE,
    { and: [{ fieldName: 'ProviderInstance', operator: '=', value: String(providerInstances[0].id) }] },
    SEARCH_PAGE_SIZE,
    page,
  );

  const results = records
    .map((record) => {
      const command = fieldString(record, 'Command');
      return command ? searchItem(fieldString(record, 'Name') ?? command, command) : null;
    })
    .filter((item): item is INodeListSearchItems => item !== null)
    .filter((item) => matchesFilter(item, filter));

  return pickerPage(results, page, records.length);
}

/**
 * Controllers registered on the instance (`SystemController`). The stored value
 * is the controller's `Name` — the segment that goes into
 * `POST /controller/{ControllerName}` — while the label prefers a human-readable
 * `Label`/`Title`/`Description` when the record carries one.
 *
 * Entries are sorted within each page rather than across the whole table: the
 * API is not asked to order by `Name` because that field is only assumed to
 * exist (hence the `ClassName` fallback), and a bad sort field would fail the
 * request outright instead of degrading.
 */
export async function searchControllers(
  this: ILoadOptionsFunctions,
  filter?: string,
  paginationToken?: string,
): Promise<INodeListSearchResult> {
  const page = pageFrom(paginationToken);
  const records = await listRecords(this, CONTROLLER_TABLE, undefined, SEARCH_PAGE_SIZE, page);

  const results = records
    .map((record) => {
      const name = fieldString(record, 'Name') ?? fieldString(record, 'ClassName');
      if (!name) {
        return null;
      }
      const label = CONTROLLER_LABEL_FIELDS.map((field) => fieldString(record, field)).find(
        (value) => value !== undefined,
      );
      return searchItem(label ?? name, name);
    })
    .filter((item): item is INodeListSearchItems => item !== null)
    .filter((item) => matchesFilter(item, filter))
    .sort((a, b) => a.name.localeCompare(b.name));

  return pickerPage(results, page, records.length);
}

/** The `methods` block attached to both nodes. */
export const listSearchMethods = {
  listSearch: {
    searchTables,
    searchObjectRecords,
    searchParentRecords,
    searchAttachments,
    searchQueues,
    searchActions,
    searchControllers,
  },
};
