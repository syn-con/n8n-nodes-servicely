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

/** Read a Table resourceLocator parameter's extracted value (empty string if unset). */
function readTableParam(ctx: ILoadOptionsFunctions, name: string): string {
  return String(ctx.getNodeParameter(name, '', { extractValue: true }) ?? '').trim();
}

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
  return searchRecordsInTable(this, readTableParam(this, 'tableName'), filter);
}

/** List-search: records of the Attachment resource's `parentTable`. */
export async function searchParentRecords(
  this: ILoadOptionsFunctions,
  filter?: string,
): Promise<INodeListSearchResult> {
  return searchRecordsInTable(this, readTableParam(this, 'parentTable'), filter);
}

/** List-search: records of the `Attachment` table (Attachment ID picker). */
export async function searchAttachments(
  this: ILoadOptionsFunctions,
  filter?: string,
): Promise<INodeListSearchResult> {
  return searchRecordsInTable(this, 'Attachment', filter);
}
