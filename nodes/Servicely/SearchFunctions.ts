import type {
  IDataObject,
  ILoadOptionsFunctions,
  INodeListSearchItems,
  INodeListSearchResult,
  INodePropertyOptions,
} from 'n8n-workflow';

import { CONTROLLER_TABLE, GLOBAL_SEARCH_PATH, GLOBAL_SEARCH_REQUESTS } from './constants';
import { servicelyApiRequest, toRecordList } from './GenericFunctions';
import type { ServicelyRecord } from './types';

/**
 * The dynamic-option loaders the package's nodes expose: `methods.listSearch`
 * backing the "From List" mode of every resourceLocator (the Table, Field, and
 * Record pickers on the Servicely node, the Queue / Action Name pickers on the
 * trigger), plus the `methods.loadOptions` entries feeding the multi-selects —
 * `getFields` for the field dropdowns in the Options collections, `getAiAgents`
 * for the AI Tool node's AI Agents selector.
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

/** Field of a Global Search config entry holding the searchable table's class name. */
const GLOBAL_SEARCH_TABLE_FIELD = 'table';

/** Async Integration lookups: the provider table, action table, and connection-type filter. */
const QUEUE_TABLE = 'ActionProviderInstance';
const ACTION_TABLE = 'Action';
const ASYNC_CONNECTION_TYPE = 'async_integration';

const ID_FIELD = 'id';
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
 * The instance's table registry: one row per table. TABLE_NAME_FIELD holds the
 * API table name — the segment that goes into `/v1/{table}` — and that is what
 * the picker shows. What it *stores* is the row's id, because that is what
 * `FieldDefinition` references, so the Field pickers need no lookup of their own.
 * The operations still need the name, and read it off the locator's cached label
 * (see `locatorLabel`), which also covers a table typed by name or arriving from
 * an expression.
 */
const TABLE_DEFINITION_TABLE = 'TableDefinition';

/** Field holding a table's API name in `TableDefinition`. */
const TABLE_NAME_FIELD = 'Table';

/** The instance's field registry: one row per field per table. */
const FIELD_DEFINITION_TABLE = 'FieldDefinition';

/**
 * `FieldDefinition` reference back to the table a field belongs to. It holds the
 * `TableDefinition` row's id, not the table name — which is the id the table
 * picker stores, so a table's fields are one query with nothing to resolve first.
 */
const FIELD_TABLE_FIELD = 'Table';

/** `FieldDefinition` field holding the API name of the field itself. */
const FIELD_NAME_FIELD = 'FieldName';

/** The instance's AI agents, offered by the AI Tool node's AI Agents selector. */
const AI_AGENT_TABLE = 'SystemAIAgent';

/** The instance's AI assistants, offered by the AI Assistants selector. */
const AI_ASSISTANT_TABLE = 'SystemAIAssistant';

/** The instance's roles, offered by the AI Tool node's Roles selector. */
const ROLE_TABLE = 'Role';

/** Field holding the display name in the AI registries and in the role table. */
const AI_NAME_FIELD = 'Name';

/** These registries are small, so they are read in large pages. */
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

  // Pagination is inherently sequential
  for (let page = 1; page <= MAX_DISCOVERY_PAGES; page++) {
    let batch: ServicelyRecord[];
    try {
      batch = await listRecords(ctx, table, query, pageSize, page);
    } catch (error) {
      if (page === 1) {
        // eslint-disable-next-line @n8n/community-nodes/require-node-api-error -- listRecords already threw a NodeApiError; a later page failing is answered with the rows already found
        throw error;
      }
      return rows;
    }
    rows.push(...batch);
    if (batch.length < pageSize) {
      return rows;
    }
  }

  return rows;
}

/**
 * Every `TableDefinition` row as a search item, keyed and labelled by its API
 * table name, deduped and sorted. Rows carrying no name are skipped; a registry
 * that cannot be read at all leaves the list empty, and tables stay reachable
 * via the locator's "By Name" mode.
 */
export async function discoverTables(ctx: ILoadOptionsFunctions): Promise<INodeListSearchItems[]> {
  let rows: ServicelyRecord[];
  try {
    rows = await allRows(ctx, TABLE_DEFINITION_TABLE, DISCOVERY_PAGE_SIZE);
  } catch {
    return [];
  }

  const byName = new Map<string, INodeListSearchItems>();
  for (const row of rows) {
    const name = fieldString(row, TABLE_NAME_FIELD)?.trim();
    if (name === undefined || byName.has(name)) {
      continue;
    }
    const id = fieldString(row, ID_FIELD)?.trim();
    byName.set(name, searchItem(name, id ?? name));
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Every `FieldDefinition` row of one table as a search item, exactly as
 * `discoverTables` treats the table registry: keyed and labelled by the field's
 * API name, rows carrying no name skipped, deduped and sorted. The rows are the
 * ones referencing `table`, which is whatever the table locator resolved to — the
 * `TableDefinition` row id when it was picked from the list. A registry that
 * cannot be read (or a table it does not know) leaves the list empty, and fields
 * stay reachable via the locator's "By Name" mode.
 */
export async function discoverFields(ctx: ILoadOptionsFunctions, table: string): Promise<INodeListSearchItems[]> {
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
  const byName = new Map<string, INodeListSearchItems>();
  for (const row of rows) {
    const name = fieldString(row, FIELD_NAME_FIELD)?.trim();
    if (name === undefined || byName.has(name)) {
      continue;
    }
    byName.set(name, searchItem(name, name));
  }


  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// listSearch methods
// ---------------------------------------------------------------------------

/** Every table the instance's `TableDefinition` registry lists (Table picker). */
export async function searchTables(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
  const results = (await discoverTables(this)).filter((item) => matchesFilter(item, filter));
  return { results };
}

/** Records of the Attachment resource's `parentTable`. */
export async function searchParentRecords(
  this: ILoadOptionsFunctions,
  filter?: string,
  paginationToken?: string,
): Promise<INodeListSearchResult> {
  return searchRecordsInTable(this, readLocatorValue(this, 'parentTable'), filter, paginationToken);
}

/**
 * Tables the Global Search controller is configured to search. This is the one
 * picker that is not a table read: the controller answers its own configuration
 * when posted `{"request_type": "search_config"}`, one entry per searchable table
 * as `{ id, table }`. Only `table` is used — as both the label and the stored
 * value, because that is the `table_class` the search operations send back, and
 * the entry's own `id` means nothing to them.
 *
 * The configuration arrives in a single response, so this filters client-side and
 * never pages. An instance without the controller fails the request, which the
 * picker surfaces as an error rather than an empty list — the locator's "By Name"
 * mode is the way past it.
 */
export async function searchGlobalSearchTables(
  this: ILoadOptionsFunctions,
  filter?: string,
): Promise<INodeListSearchResult> {
  const entries = toRecordList<ServicelyRecord>(
    await servicelyApiRequest.call(this, 'POST', GLOBAL_SEARCH_PATH, {
      request_type: GLOBAL_SEARCH_REQUESTS.config,
    }),
  );

  const byTable = new Map<string, INodeListSearchItems>();
  for (const entry of entries) {
    const table = fieldString(entry, GLOBAL_SEARCH_TABLE_FIELD)?.trim();
    if (table === undefined || byTable.has(table)) {
      continue;
    }
    byTable.set(table, searchItem(table, table));
  }

  return {
    results: [...byTable.values()]
      .filter((item) => matchesFilter(item, filter))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
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

/**
 * Fields of the selected `tableName`, backing the Field locators nested in Get
 * Many's Filters and Create/Update's Fields to Set. Being a listSearch method
 * rather than a loadOptions one, the registry is read when the dropdown opens,
 * so switching tables can never serve the previous table's fields.
 */
export async function searchFields(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
  const fields = await discoverFields(this, readLocatorValue(this, 'tableName'));
  return { results: fields.filter((item) => matchesFilter(item, filter)) };
}

/**
 * Fields of the selected `tableName` as dropdown options, backing the Fields /
 * Display Value Fields multi-selects and the Sort Field picker in the Options
 * collections. A `loadOptions` method rather than a `listSearch` one because
 * `multiOptions` (n8n's only multi-select) can be fed no other way; the
 * properties name `tableName.value` in `loadOptionsDependsOn`, so switching
 * tables reloads the list instead of serving the previous table's fields.
 *
 * A table that the registry cannot answer for — unreadable, or set by an
 * expression that design time cannot resolve — yields an empty list. The
 * selectors then stay reachable by switching the parameter to an expression.
 */
export async function getFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
  const fields = await discoverFields(this, readLocatorValue(this, 'tableName'));
  return fields.map((field) => ({ name: field.name, value: String(field.value) }));
}

/**
 * Every row of a registry as an option labelled by its `Name` and storing its
 * record id — the id being what a tool's holder is referenced by. Rows with no id
 * are skipped, since there would be nothing to store, and one that repeats an id
 * already seen is dropped.
 *
 * A registry that cannot be read leaves the list empty rather than failing the
 * dropdown; the agents and assistants of a tool are optional either way.
 */
async function recordsByName(
  ctx: ILoadOptionsFunctions,
  table: string,
): Promise<INodePropertyOptions[]> {
  let rows: ServicelyRecord[];
  try {
    rows = await allRows(ctx, table, DISCOVERY_PAGE_SIZE);
  } catch {
    return [];
  }
  const byId = new Map<string, INodePropertyOptions>();
  for (const row of rows) {
    const id = fieldString(row, ID_FIELD)?.trim();
    if (id === undefined || byId.has(id)) {
      continue;
    }
    byId.set(id, { name: fieldString(row, AI_NAME_FIELD) ?? id, value: id });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The instance's AI agents, backing the AI Tool node's **AI Agents** multi-select. */
export async function getAiAgents(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
  return recordsByName(this, AI_AGENT_TABLE);
}

/** The instance's AI assistants, backing the **AI Assistants** multi-select. */
export async function getAiAssistants(
  this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
  return recordsByName(this, AI_ASSISTANT_TABLE);
}

/**
 * The instance's roles, backing the AI Tool node's **Roles** multi-select. Read
 * exactly as the AI registries are — labelled by `Name`, storing the record id,
 * unreadable table leaving the list empty — because a tool's roles are stored the
 * same way: a list of record ids on the tool.
 */
export async function getRoles(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
  return recordsByName(this, ROLE_TABLE);
}

/** The `methods` block attached to both nodes. */
export const listSearchMethods = {
  loadOptions: {
    getAiAgents,
    getAiAssistants,
    getFields,
    getRoles,
  },
  listSearch: {
    searchTables,
    searchFields,
    searchParentRecords,
    searchGlobalSearchTables,
    searchQueues,
    searchActions,
    searchControllers,
  },
};
