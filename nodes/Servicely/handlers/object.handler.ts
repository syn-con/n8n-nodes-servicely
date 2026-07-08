import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { DEFAULT_PAGE_SIZE } from '../constants';
import { parseList } from '../methods/resolve';
import type {
  IServicelyClient,
  ListQueryParams,
  QueryCriterion,
  QueryOperator,
  ServicelyQuery,
  ServicelyRecord,
} from '../types';

/** Field-value pair emitted by the `fieldsToSet` fixedCollection. */
interface FieldEntry {
  name: string;
  value: string;
}

/** A single simple-mode filter row from the `filters` fixedCollection. */
interface FilterCondition {
  fieldName: string;
  operator: QueryOperator;
  value?: string;
}

/** Operators that take no value. */
const VALUELESS_OPERATORS: ReadonlySet<QueryOperator> = new Set(['isempty', 'isnotempty']);
/** Operators whose value is a comma-separated list. */
const LIST_OPERATORS: ReadonlySet<QueryOperator> = new Set(['in', 'notIn', 'between']);

/** Options bag telling n8n to return a resourceLocator's underlying value. */
const EXTRACT_VALUE = { extractValue: true } as const;

/** Read the Table resourceLocator's resolved table name. */
function readTable(ctx: IExecuteFunctions, i: number): string {
  return ctx.getNodeParameter('tableName', i, '', EXTRACT_VALUE) as string;
}

/** Read the Record resourceLocator's resolved record id. */
function readRecordId(ctx: IExecuteFunctions, i: number): string {
  return ctx.getNodeParameter('recordId', i, '', EXTRACT_VALUE) as string;
}

function toItem(record: ServicelyRecord): INodeExecutionData {
  return { json: record as IDataObject };
}

/** Read field/displayValue/relation selectors shared by Get and Get All. */
function readSelectors(ctx: IExecuteFunctions, i: number): ListQueryParams {
  const params: ListQueryParams = {};
  const fields = ctx.getNodeParameter('options.fields', i, '') as string;
  const displayValues = ctx.getNodeParameter('options.displayValues', i, '') as string;
  const relations = ctx.getNodeParameter('options.relations', i, '') as string;
  if (fields) { params.fields = fields; }
  if (displayValues) { params.displayValues = displayValues; }
  if (relations) { params.relations = relations; }
  return params;
}

function readAdvancedQuery(ctx: IExecuteFunctions, i: number): ServicelyQuery | undefined {
  const raw = ctx.getNodeParameter('options.query', i, '') as string | IDataObject;
  if (!raw || (typeof raw === 'string' && raw.trim() === '')) {
    return undefined;
  }
  if (typeof raw !== 'string') {
    return raw as ServicelyQuery;
  }
  try {
    return JSON.parse(raw) as ServicelyQuery;
  } catch (error) {
    throw new Error(`Invalid Query JSON: ${(error as Error).message}`);
  }
}

/** Convert one simple-mode filter row into a query criterion. */
function toCriterion(condition: FilterCondition): QueryCriterion {
  const { fieldName, operator } = condition;
  if (VALUELESS_OPERATORS.has(operator)) {
    return { fieldName, operator };
  }
  if (LIST_OPERATORS.has(operator)) {
    return { fieldName, operator, value: parseList(condition.value ?? '') };
  }
  return { fieldName, operator, value: condition.value ?? '' };
}

/** Build an AND query from the simple `filters` fixedCollection, if any rows are set. */
function readSimpleQuery(ctx: IExecuteFunctions, i: number): ServicelyQuery | undefined {
  const conditions = ctx.getNodeParameter('filters.conditions', i, []) as FilterCondition[];
  const criteria = conditions.filter((c) => c.fieldName).map(toCriterion);
  return criteria.length > 0 ? { and: criteria } : undefined;
}

/** Advanced JSON query wins when present; otherwise fall back to the simple filter builder. */
function readQuery(ctx: IExecuteFunctions, i: number): ServicelyQuery | undefined {
  return readAdvancedQuery(ctx, i) ?? readSimpleQuery(ctx, i);
}

function applySort(ctx: IExecuteFunctions, i: number, params: ListQueryParams): void {
  const sortField = ctx.getNodeParameter('options.sortField', i, '') as string;
  if (!sortField) {
    return;
  }
  const descending = ctx.getNodeParameter('options.sortDescending', i, false) as boolean;
  if (descending) {
    params.order_desc = sortField;
  } else {
    params.order = sortField;
  }
}

function readFieldsToSet(ctx: IExecuteFunctions, i: number): IDataObject {
  const entries = ctx.getNodeParameter('fieldsToSet.field', i, []) as FieldEntry[];
  const data: IDataObject = {};
  for (const entry of entries) {
    if (entry.name) {
      data[entry.name] = entry.value;
    }
  }
  return data;
}

async function getOne(ctx: IExecuteFunctions, client: IServicelyClient, i: number): Promise<INodeExecutionData[]> {
  const table = readTable(ctx, i);
  const id = readRecordId(ctx, i);
  const record = await client.getOne<ServicelyRecord>(table, id, readSelectors(ctx, i));
  return [toItem(record)];
}

async function getAll(ctx: IExecuteFunctions, client: IServicelyClient, i: number): Promise<INodeExecutionData[]> {
  const table = readTable(ctx, i);
  const params = readSelectors(ctx, i);
  const query = readQuery(ctx, i);
  if (query) { params.query = query; }
  applySort(ctx, i, params);

  const returnAll = ctx.getNodeParameter('returnAll', i, false) as boolean;
  if (!returnAll) {
    const limit = ctx.getNodeParameter('limit', i, 50) as number;
    const result = await client.get<ServicelyRecord>(table, { ...params, page: 1, page_size: limit });
    return result.data.slice(0, limit).map(toItem);
  }

  const records: ServicelyRecord[] = [];
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    // eslint-disable-next-line no-await-in-loop -- pagination is inherently sequential
    const result = await client.get<ServicelyRecord>(table, { ...params, page, page_size: DEFAULT_PAGE_SIZE });
    records.push(...result.data);
    hasMore = result.meta.hasMore && result.data.length > 0;
    page += 1;
  }
  return records.map(toItem);
}

async function create(ctx: IExecuteFunctions, client: IServicelyClient, i: number): Promise<INodeExecutionData[]> {
  const table = readTable(ctx, i);
  const record = await client.create<ServicelyRecord>(table, readFieldsToSet(ctx, i));
  return [toItem(record)];
}

async function update(ctx: IExecuteFunctions, client: IServicelyClient, i: number): Promise<INodeExecutionData[]> {
  const table = readTable(ctx, i);
  const id = readRecordId(ctx, i);
  const record = await client.update<ServicelyRecord>(table, id, readFieldsToSet(ctx, i));
  return [toItem(record)];
}

async function remove(ctx: IExecuteFunctions, client: IServicelyClient, i: number): Promise<INodeExecutionData[]> {
  const table = readTable(ctx, i);
  const id = readRecordId(ctx, i);
  await client.delete(table, id);
  return [{ json: { success: true, table, id } }];
}

/** Route an Object operation to its handler. */
export async function executeObjectOperation(
  ctx: IExecuteFunctions,
  client: IServicelyClient,
  operation: string,
  i: number,
): Promise<INodeExecutionData[]> {
  switch (operation) {
    case 'get':
      return getOne(ctx, client, i);
    case 'getAll':
      return getAll(ctx, client, i);
    case 'create':
      return create(ctx, client, i);
    case 'update':
      return update(ctx, client, i);
    case 'delete':
      return remove(ctx, client, i);
    default:
      throw new Error(`Unsupported Object operation: ${operation}`);
  }
}
