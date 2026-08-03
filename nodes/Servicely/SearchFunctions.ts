import type { IDataObject, ILoadOptionsFunctions, INodeListSearchItems, INodeListSearchResult } from 'n8n-workflow';

import { servicelyApiRequest, toRecordList } from './GenericFunctions';
import type { BatchRequest, BatchResponse, ServicelyRecord } from './types';

/**
 * `methods.listSearch` implementations backing the "From List" mode of every
 * resourceLocator: the Table and Record pickers on the Servicely node, and the
 * Queue / Action Name pickers on the trigger.
 */

/** How many records to fetch for a searchable picker (first page only). */
const SEARCH_PAGE_SIZE = 100;

/** Fields tried, in order, to derive a human-readable label for a record. */
const LABEL_FIELDS = ['Number', 'Name', 'Title', 'ShortDescription', 'FileName', 'DisplayName', 'Email', 'Label'];

/** Async Integration lookups: the provider table, action table, and connection-type filter. */
const QUEUE_TABLE = 'ActionProviderInstance';
const ACTION_TABLE = 'Action';
const ASYNC_CONNECTION_TYPE = 'async_integration';

/** Fetch the first page of a table, optionally filtered by a complex query. */
async function listRecords(
  ctx: ILoadOptionsFunctions,
  table: string,
  query?: IDataObject,
  pageSize = SEARCH_PAGE_SIZE,
): Promise<ServicelyRecord[]> {
  const qs: IDataObject = { page: 1, page_size: pageSize };
  if (query) {
    qs.query = JSON.stringify(query);
  }
  return toRecordList<ServicelyRecord>(await servicelyApiRequest.call(ctx, 'GET', `/v1/${table}`, undefined, qs));
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
 * Fetch a table's first page as search items, filtered client-side (the REST API
 * has no generic text-search parameter), so matches beyond the first page are
 * not surfaced.
 */
async function searchRecordsInTable(
  ctx: ILoadOptionsFunctions,
  table: string,
  filter?: string,
): Promise<INodeListSearchResult> {
  if (!table) {
    return { results: [] };
  }
  const records = await listRecords(ctx, table);
  const results = records
    .map((record) => searchItem(recordLabel(record), String(record.id)))
    .filter((item) => matchesFilter(item, filter));
  return { results };
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

/** Numbering/CMDB registries are small; one large page captures them all. */
const DISCOVERY_PAGE_SIZE = 2000;

/** Non-empty string value whose (lowercased) key matches `field`. */
function valueForKey(row: ServicelyRecord, field: string): string | undefined {
  const wanted = field.toLowerCase();
  const key = Object.keys(row).find((candidate) => candidate.toLowerCase() === wanted);
  const value = key === undefined ? undefined : row[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** Read `field` off every row of a metadata table, trying name casings, tolerating errors. */
async function namesFrom(ctx: ILoadOptionsFunctions, table: string, field: string): Promise<string[]> {
  const pascal = table.charAt(0).toUpperCase() + table.slice(1);
  for (const name of new Set([table, pascal])) {
    try {
      // eslint-disable-next-line no-await-in-loop -- casings are tried in order until one responds
      const rows = await listRecords(ctx, name, undefined, DISCOVERY_PAGE_SIZE);
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
): Promise<INodeListSearchResult> {
  return searchRecordsInTable(this, readLocatorValue(this, 'tableName'), filter);
}

/** Records of the Attachment resource's `parentTable`. */
export async function searchParentRecords(
  this: ILoadOptionsFunctions,
  filter?: string,
): Promise<INodeListSearchResult> {
  return searchRecordsInTable(this, readLocatorValue(this, 'parentTable'), filter);
}

/** Records of the `Attachment` table (Attachment picker). */
export async function searchAttachments(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
  return searchRecordsInTable(this, 'Attachment', filter);
}

/**
 * Async-integration queues, i.e. `ActionProviderInstance` records whose
 * `ConnectionType` is `async_integration`. The stored value is the record's
 * `ConnectionString` (the queue identifier used when dequeuing).
 */
export async function searchQueues(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
  const records = await listRecords(this, QUEUE_TABLE, {
    and: [{ fieldName: 'ConnectionType', operator: '=', value: ASYNC_CONNECTION_TYPE }],
  });

  const results = records
    .map((record) => {
      const connectionString = fieldString(record, 'ConnectionString');
      return connectionString ? searchItem(fieldString(record, 'Name') ?? connectionString, connectionString) : null;
    })
    .filter((item): item is INodeListSearchItems => item !== null)
    .filter((item) => matchesFilter(item, filter));

  return { results };
}

/**
 * `Action` records belonging to the selected queue's provider instance. Resolves
 * the ProviderInstance id from the chosen queue's ConnectionString, then lists
 * Actions filtered by `ProviderInstance`; the stored value is each Action's
 * `Command`.
 */
export async function searchActions(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
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

  const records = await listRecords(this, ACTION_TABLE, {
    and: [{ fieldName: 'ProviderInstance', operator: '=', value: String(providerInstances[0].id) }],
  });

  const results = records
    .map((record) => {
      const command = fieldString(record, 'Command');
      return command ? searchItem(fieldString(record, 'Name') ?? command, command) : null;
    })
    .filter((item): item is INodeListSearchItems => item !== null)
    .filter((item) => matchesFilter(item, filter));

  return { results };
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
  },
};
