import type {
  IDataObject,
  ILoadOptionsFunctions,
  INodeListSearchItems,
  INodeListSearchResult,
  INodePropertyOptions,
} from 'n8n-workflow';

import { CONTROLLER_TABLE } from './constants';
import { servicelyApiRequest, toRecordList } from './GenericFunctions';
import type { ServicelyRecord } from './types';

/**
 * The nodes' dynamic parameter loaders.
 *
 * `methods.listSearch` backs the "From List" mode of every resourceLocator: the
 * Table and Record pickers on the Servicely node, and the Queue / Action Name
 * pickers on the trigger. `methods.loadOptions` backs the Field dropdowns nested
 * inside fixedCollections, where a resourceLocator's `{mode, value}` shape would
 * not fit the plain strings those rows store.
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
const CONTROLLER_LABEL_FIELDS = ['Name'];

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

/**
 * A picker entry showing the label alone — never the stored id. n8n already
 * renders the selected value under the locator, so repeating it as `Label (id)`
 * only made long lists harder to scan.
 */
function searchItem(label: string, value: string): INodeListSearchItems {
  return { name: label, value };
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
// Schema registries (tables and their fields)
// ---------------------------------------------------------------------------

/**
 * The instance's table registry. One row per table; TABLE_LABEL_FIELD holds the
 * human-readable class shown in the picker and `id` is the table name that goes
 * into `/v1/{table}`, so a row maps straight onto a search item without any
 * name-to-endpoint translation.
 */
const TABLE_DEFINITION_TABLE = 'TableDefinition';

/** Field holding a table's display label in `TableDefinition`. */
const TABLE_LABEL_FIELD = 'Table';

/** The instance's field registry: one row per field per table. */
const FIELD_DEFINITION_TABLE = 'FieldDefinition';

/** `FieldDefinition` reference back to the table a field belongs to. */
const FIELD_TABLE_FIELD = 'Table';

/** `FieldDefinition` field holding the API name of the field itself. */
const FIELD_NAME_FIELD = 'FieldName';

/** Both registries are small, so they are read in large pages. */
const DISCOVERY_PAGE_SIZE = 2000;

/**
 * Ceiling on registry paging. Both the Table picker and the Field dropdown load
 * their whole list in one go (neither is `searchable`, so n8n filters
 * client-side and never asks for a second page), which means the paging happens
 * here — and design-time work has to stay bounded even if a registry turns out
 * to be unexpectedly large.
 */
const MAX_DISCOVERY_PAGES = 10;

/**
 * Every row of a table, paged to the end (or to MAX_DISCOVERY_PAGES). A failure
 * on the first page propagates, so the caller can surface "the registry did not
 * answer"; a failure once rows are in hand keeps the partial read instead, a
 * half-populated picker being more useful than an error.
 */
async function allRows(
  ctx: ILoadOptionsFunctions,
  table: string,
  pageSize: number,
  query?: IDataObject,
): Promise<ServicelyRecord[]> {
  const rows: ServicelyRecord[] = [];

  /* eslint-disable no-await-in-loop -- pagination is inherently sequential */
  for (let page = 1; page <= MAX_DISCOVERY_PAGES; page++) {
    let batch: ServicelyRecord[];
    try {
      batch = await listRecords(ctx, table, query, pageSize, page);
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

/**
 * Every `TableDefinition` row as a search item — TABLE_LABEL_FIELD for the
 * label, `id` for the stored value — deduped on the value and sorted by label.
 * Rows with no usable id are skipped; a registry that cannot be read at all
 * leaves the list empty, and tables stay reachable via the locator's "By Name"
 * mode.
 */
export async function discoverTables(ctx: ILoadOptionsFunctions): Promise<INodeListSearchItems[]> {
  let rows: ServicelyRecord[];
  try {
    rows = await allRows(ctx, TABLE_DEFINITION_TABLE, DISCOVERY_PAGE_SIZE);
  } catch {
    return [];
  }

  const byValue = new Map<string, INodeListSearchItems>();
  for (const row of rows) {
    const value = fieldString(row, 'id');
    if (value === undefined || byValue.has(value)) {
      continue;
    }
    byValue.set(value, searchItem(fieldString(row, TABLE_LABEL_FIELD) ?? value, value));
  }

  return [...byValue.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Field names of one table, from `FieldDefinition` rows whose `Table` reference
 * matches it — that reference holds the table id, which is exactly what the
 * Table picker stores. Deduped and sorted; a registry that cannot be read leaves
 * the list empty rather than failing the parameter load.
 */
export async function discoverFields(ctx: ILoadOptionsFunctions, table: string): Promise<string[]> {
  if (!table) {
    return [];
  }

  let rows: ServicelyRecord[];
  try {
    rows = await allRows(ctx, FIELD_DEFINITION_TABLE, DISCOVERY_PAGE_SIZE, {
      and: [{ fieldName: FIELD_TABLE_FIELD, operator: '=', value: table }],
    });
  } catch {
    return [];
  }

  const names = new Set<string>();
  for (const row of rows) {
    const name = fieldString(row, FIELD_NAME_FIELD);
    if (name !== undefined) {
      names.add(name);
    }
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// listSearch methods
// ---------------------------------------------------------------------------

/** Every table the instance's `TableDefinition` registry lists (Table picker). */
export async function searchTables(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
  const results = (await discoverTables(this)).filter((item) => matchesFilter(item, filter));
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

// ---------------------------------------------------------------------------
// loadOptions methods
// ---------------------------------------------------------------------------

/**
 * Fields of the selected `tableName`, for the Field dropdowns nested in Get
 * Many's Filters and Create/Update's Fields to Set. These are `options` rather
 * than resourceLocators so the stored value stays a plain field-name string —
 * the shape `buildListQuery` and `fieldsToSet` already read, which keeps
 * existing workflows working. `loadOptionsDependsOn` reloads the list whenever
 * the table changes.
 */
export async function getFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
  const fields = await discoverFields(this, readLocatorValue(this, 'tableName'));
  return fields.map((field) => ({ name: field, value: field }));
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
  loadOptions: {
    getFields,
  },
};
