import type { IDataObject, INodeExecutionData, IPollFunctions } from 'n8n-workflow';

import { buildAndQuery, parseAdvancedQuery, type FilterCondition } from '../query';
import type { IServicelyClient, ListQueryParams, ServicelyRecord } from '../types';

/** Options bag telling n8n to return a resourceLocator's underlying value. */
const EXTRACT_VALUE = { extractValue: true } as const;

/** Advanced JSON query wins when present; otherwise build one from simple filters. */
function readQuery(ctx: IPollFunctions): ListQueryParams['query'] {
  const advanced = parseAdvancedQuery(ctx.getNodeParameter('options.query', '') as string | IDataObject);
  if (advanced) {
    return advanced;
  }
  return buildAndQuery(ctx.getNodeParameter('filters.conditions', []) as FilterCondition[]);
}

/** Read the field/displayValue/relation selectors from the Options collection. */
function readSelectors(ctx: IPollFunctions): ListQueryParams {
  const params: ListQueryParams = {};
  const fields = ctx.getNodeParameter('options.fields', '') as string;
  const displayValues = ctx.getNodeParameter('options.displayValues', '') as string;
  const relations = ctx.getNodeParameter('options.relations', '') as string;
  if (fields) {
    params.fields = fields;
  }
  if (displayValues) {
    params.displayValues = displayValues;
  }
  if (relations) {
    params.relations = relations;
  }
  return params;
}

function applySort(ctx: IPollFunctions, params: ListQueryParams): void {
  const sortField = ctx.getNodeParameter('options.sortField', '') as string;
  if (!sortField) {
    return;
  }
  if (ctx.getNodeParameter('options.sortDescending', false) as boolean) {
    params.order_desc = sortField;
  } else {
    params.order = sortField;
  }
}

/**
 * Poll a Servicely table for records matching the configured filter and return
 * them as items. Reuses the Get Many query surface; each poll returns the
 * current matches (up to Limit).
 */
export async function pollObjects(ctx: IPollFunctions, client: IServicelyClient): Promise<INodeExecutionData[]> {
  const table = ctx.getNodeParameter('tableName', '', EXTRACT_VALUE) as string;
  const params = readSelectors(ctx);
  const query = readQuery(ctx);
  if (query) {
    params.query = query;
  }
  applySort(ctx, params);

  const limit = ctx.getNodeParameter('limit', 50) as number;
  const result = await client.get<ServicelyRecord>(table, { ...params, page: 1, page_size: limit });
  return result.data.slice(0, limit).map((record) => ({ json: record as IDataObject }));
}
