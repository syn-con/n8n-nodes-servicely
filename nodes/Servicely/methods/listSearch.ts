import type { ILoadOptionsFunctions, INodeListSearchItems, INodeListSearchResult } from 'n8n-workflow';

import { buildClient } from '../transport/clientFactory';
import { discoverTables } from './tableDiscovery';
import type { ServicelyRecord } from '../types';

/** Fields tried, in order, to derive a human-readable label for a record. */
const LABEL_FIELDS = ['Number', 'Name', 'Title', 'ShortDescription', 'FileName', 'DisplayName', 'Email', 'Label'];

/** How many records to fetch for the searchable record picker (first page only). */
const RECORD_SEARCH_PAGE_SIZE = 100;

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

function toSearchItem(record: ServicelyRecord): INodeListSearchItems {
  const id = String(record.id);
  const label = recordLabel(record);
  return { name: label === id ? id : `${label} (${id})`, value: id };
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

/** Async Integration lookups: the provider table, action table, and connection-type filter. */
const QUEUE_TABLE = 'ActionProviderInstance';
const ACTION_TABLE = 'Action';
const ASYNC_CONNECTION_TYPE = 'async_integration';

/**
 * Fetch the first page of a table and map it to search items. Filtering is
 * applied client-side over the fetched page (the REST API has no generic
 * text-search parameter), so matches beyond the first page are not surfaced.
 */
async function searchRecordsInTable(
  ctx: ILoadOptionsFunctions,
  table: string,
  filter?: string,
): Promise<INodeListSearchResult> {
  if (!table) {
    return { results: [] };
  }
  const client = await buildClient(ctx);
  const { data } = await client.get<ServicelyRecord>(table, { page: 1, page_size: RECORD_SEARCH_PAGE_SIZE });
  const results = data.map(toSearchItem).filter((item) => matchesFilter(item, filter));
  return { results };
}

/** List-search: table names discovered dynamically from the instance (Table picker). */
export async function searchTables(
  this: ILoadOptionsFunctions,
  filter?: string,
): Promise<INodeListSearchResult> {
  const client = await buildClient(this);
  const tables = await discoverTables(client);
  const results = tables.map((table) => ({ name: table, value: table })).filter((item) => matchesFilter(item, filter));
  return { results };
}

/** List-search: records of the Object resource's selected `tableName`. */
export async function searchObjectRecords(
  this: ILoadOptionsFunctions,
  filter?: string,
): Promise<INodeListSearchResult> {
  return searchRecordsInTable(this, readLocatorValue(this, 'tableName'), filter);
}

/** List-search: records of the Attachment resource's `parentTable`. */
export async function searchParentRecords(
  this: ILoadOptionsFunctions,
  filter?: string,
): Promise<INodeListSearchResult> {
  return searchRecordsInTable(this, readLocatorValue(this, 'parentTable'), filter);
}

/** Map an ActionProviderInstance record to a queue item keyed by its ConnectionString. */
function queueSearchItem(record: ServicelyRecord): INodeListSearchItems | null {
  const connectionString = fieldString(record, 'ConnectionString');
  if (!connectionString) {
    return null;
  }
  const label = fieldString(record, 'Name') ?? connectionString;
  return { name: label === connectionString ? connectionString : `${label} (${connectionString})`, value: connectionString };
}

/** Map an Action record to an item keyed by its `Command`. */
function actionSearchItem(record: ServicelyRecord): INodeListSearchItems | null {
  const command = fieldString(record, 'Command');
  if (!command) {
    return null;
  }
  const label = fieldString(record, 'Name') ?? command;
  return { name: label === command ? command : `${label} (${command})`, value: command };
}

/** Resolve the ActionProviderInstance id backing a selected queue (its ConnectionString). */
async function resolveProviderInstanceId(
  ctx: ILoadOptionsFunctions,
  connectionString: string,
): Promise<string | undefined> {
  const client = await buildClient(ctx);
  const { data } = await client.get<ServicelyRecord>(QUEUE_TABLE, {
    query: {
      and: [
        { fieldName: 'ConnectionType', operator: '=', value: ASYNC_CONNECTION_TYPE },
        { fieldName: 'ConnectionString', operator: '=', value: connectionString },
      ],
    },
    page: 1,
    page_size: 1,
  });
  return data[0] ? String(data[0].id) : undefined;
}

/**
 * List-search: async-integration queues, i.e. `ActionProviderInstance` records
 * whose `ConnectionType` is `async_integration`. The stored value is the
 * record's `ConnectionString` (the queue identifier used when dequeuing).
 */
export async function searchQueues(
  this: ILoadOptionsFunctions,
  filter?: string,
): Promise<INodeListSearchResult> {
  const client = await buildClient(this);
  const { data } = await client.get<ServicelyRecord>(QUEUE_TABLE, {
    query: { and: [{ fieldName: 'ConnectionType', operator: '=', value: ASYNC_CONNECTION_TYPE }] },
    page: 1,
    page_size: RECORD_SEARCH_PAGE_SIZE,
  });
  const results = data
    .map(queueSearchItem)
    .filter((item): item is INodeListSearchItems => item !== null)
    .filter((item) => matchesFilter(item, filter));
  return { results };
}

/**
 * List-search: `Action` records belonging to the selected queue's provider
 * instance. Resolves the ProviderInstance id from the chosen queue's
 * ConnectionString, then lists Actions filtered by `ProviderInstance`; the
 * stored value is each Action's `command`.
 */
export async function searchActions(
  this: ILoadOptionsFunctions,
  filter?: string,
): Promise<INodeListSearchResult> {
  const queueValue = readLocatorValue(this, 'queue');
  if (!queueValue) {
    return { results: [] };
  }
  const providerInstanceId = await resolveProviderInstanceId(this, queueValue);
  if (!providerInstanceId) {
    return { results: [] };
  }
  const client = await buildClient(this);
  const { data } = await client.get<ServicelyRecord>(ACTION_TABLE, {
    query: { and: [{ fieldName: 'ProviderInstance', operator: '=', value: providerInstanceId }] },
    page: 1,
    page_size: RECORD_SEARCH_PAGE_SIZE,
  });
  const results = data
    .map(actionSearchItem)
    .filter((item): item is INodeListSearchItems => item !== null)
    .filter((item) => matchesFilter(item, filter));
  return { results };
}

/** List-search: records of the `Attachment` table (Attachment ID picker). */
export async function searchAttachments(
  this: ILoadOptionsFunctions,
  filter?: string,
): Promise<INodeListSearchResult> {
  return searchRecordsInTable(this, 'Attachment', filter);
}
