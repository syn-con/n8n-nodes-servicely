import {
  type IDataObject,
  type IExecuteFunctions,
  type IHttpRequestMethods,
  type IHttpRequestOptions,
  type ILoadOptionsFunctions,
  type IPollFunctions,
  type JsonObject,
  NodeApiError,
  sleep,
} from 'n8n-workflow';

import {
  DEFAULT_MAX_RETRIES,
  DEFAULT_PAGE_SIZE,
  DEFAULT_TIMEOUT_MS,
  EQUALS_UI_VALUE,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
} from './constants';
import type { FilterCondition, QueryCriterion, QueryOperator, ServicelyQuery } from './types';

/**
 * Every n8n context that talks to Servicely: the execution context, the polling
 * trigger, and the design-time load-options / list-search context. All three can
 * call `helpers.httpRequestWithAuthentication`, which is all these helpers need.
 */
export type ServicelyContext = IExecuteFunctions | ILoadOptionsFunctions | IPollFunctions;

/** Field-value pair emitted by the `fieldsToSet` fixedCollection. */
interface FieldEntry {
  name: string;
  value: string;
}

/** Read a resourceLocator's resolved value (table name, record id, ...). */
export function locator(ctx: IExecuteFunctions, name: string, index: number): string {
  return ctx.getNodeParameter(name, index, '', { extractValue: true }) as string;
}

/** Collapse the `fieldsToSet` rows into the record body to write. */
export function fieldsToSet(ctx: IExecuteFunctions, index: number): IDataObject {
  const entries = ctx.getNodeParameter('fieldsToSet.field', index, []) as FieldEntry[];
  const data: IDataObject = {};
  for (const entry of entries) {
    if (entry.name) {
      data[entry.name] = entry.value;
    }
  }
  return data;
}

/** The `{recordId}:{tableName}` reference Servicely uses for an attachment's ParentRecord. */
export function parentRef(table: string, recordId: string): string {
  return `${recordId}:${table}`;
}

/**
 * Read a node parameter from either an execute context (which takes an item
 * index) or a poll/load-options context (which does not).
 */
function nodeParameter<T>(ctx: ServicelyContext, name: string, fallback: T, itemIndex = 0): T {
  if ('getInputData' in ctx) {
    return (ctx as IExecuteFunctions).getNodeParameter(name, itemIndex, fallback) as T;
  }
  return (ctx as IPollFunctions).getNodeParameter(name, fallback) as T;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/** Retry transient failures only: 429 (rate limit) and 5xx (server). Never 4xx client errors. */
function isRetryable(statusCode: number): boolean {
  return statusCode === 429 || statusCode >= 500;
}

/** Exponential backoff with full jitter, capped at RETRY_MAX_DELAY_MS. */
function backoffDelay(attempt: number): number {
  const exponential = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** attempt);
  return Math.floor(Math.random() * exponential);
}

/** Read a response header, taking the first value when it repeats. */
function header(headers: unknown, name: string): string | undefined {
  const value = (headers as Record<string, unknown> | undefined)?.[name];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first : undefined;
}

/** Parse `Retry-After` (seconds, or an HTTP date) into milliseconds, if present. */
function retryAfterDelay(headers: unknown): number | undefined {
  const raw = header(headers, 'retry-after');
  if (raw === undefined) {
    return undefined;
  }
  const seconds = Number.parseInt(raw, 10);
  if (!Number.isNaN(seconds)) {
    return Math.min(RETRY_MAX_DELAY_MS, seconds * 1000);
  }
  const dateMs = Date.parse(raw);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, Math.min(RETRY_MAX_DELAY_MS, dateMs - Date.now()));
  }
  return undefined;
}

function asObject(body: unknown): IDataObject | undefined {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as IDataObject;
    } catch {
      return undefined;
    }
  }
  return body !== null && typeof body === 'object' ? (body as IDataObject) : undefined;
}

/** Unwrap Servicely's `{ data: ... }` envelope; other payloads pass through. */
function unwrap(body: unknown): unknown {
  const obj = asObject(body);
  return obj && 'data' in obj ? obj.data : body;
}

/** Pull messages out of `{ errors: { request: [...], <field>: [...] } }`. */
function errorMessages(body: unknown): string[] {
  const errors = asObject(body)?.errors;
  if (!errors || typeof errors !== 'object') {
    return [];
  }
  return Object.values(errors as Record<string, unknown>)
    .filter(Array.isArray)
    .flat()
    .filter((message): message is string => typeof message === 'string');
}

/** Human-readable fallbacks when the API returns no error body. */
const STATUS_MESSAGES: Record<number, string> = {
  400: 'Request validation failed.',
  401: 'Authentication failed. Verify your API token / credentials and instance URL.',
  404: 'Record not found. Check the table name and Record ID.',
  422: 'Operation blocked by validation, permissions, or business rules.',
  429: 'Rate limit exceeded. Too many requests.',
};

/** n8n-shaped response when `returnFullResponse` is set. */
interface FullResponse {
  statusCode: number;
  headers?: unknown;
  body?: unknown;
}

/** Turn a non-2xx response into a NodeApiError carrying the API's own messages. */
function apiError(ctx: ServicelyContext, request: string, response: FullResponse): NodeApiError {
  const messages = errorMessages(response.body);
  return new NodeApiError(ctx.getNode(), (asObject(response.body) ?? {}) as JsonObject, {
    message:
      messages.length > 0
        ? messages.join('; ')
        : (STATUS_MESSAGES[response.statusCode] ?? `Servicely request failed (HTTP ${response.statusCode}).`),
    httpCode: String(response.statusCode),
    description: request,
  });
}

/**
 * Call the Servicely REST API and return the payload with the `{ data: ... }`
 * envelope unwrapped. Authentication and the instance base URL come from the
 * `servicelyApi` credential's `authenticate`, so `endpoint` is a plain path
 * (e.g. `/v1/Incident`). Rate limits (429), server errors (5xx), and network
 * failures are retried with backoff up to the Request Options budget.
 */
export async function servicelyApiRequest(
  this: ServicelyContext,
  method: IHttpRequestMethods,
  endpoint: string,
  body?: IDataObject,
  qs?: IDataObject,
): Promise<unknown> {
  const requestOptions = nodeParameter<IDataObject>(this, 'requestOptions', {});
  const maxRetries = Math.max(0, (requestOptions.maxRetries as number) ?? DEFAULT_MAX_RETRIES);

  const options: IHttpRequestOptions = {
    method,
    url: endpoint,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    json: true,
    returnFullResponse: true,
    ignoreHttpStatusErrors: true,
    timeout: (requestOptions.timeout as number) ?? DEFAULT_TIMEOUT_MS,
  };
  if (body !== undefined) {
    options.body = body;
  }
  if (qs !== undefined && Object.keys(qs).length > 0) {
    options.qs = qs;
  }

  for (let attempt = 0; ; attempt++) {
    let response: FullResponse;
    try {
      // eslint-disable-next-line no-await-in-loop -- retries are inherently sequential
      response = (await this.helpers.httpRequestWithAuthentication.call(
        this,
        'servicelyApi',
        options,
      )) as FullResponse;
    } catch (error) {
      if (attempt < maxRetries) {
        // eslint-disable-next-line no-await-in-loop -- backoff before the next attempt
        await sleep(backoffDelay(attempt));
        continue;
      }
      throw new NodeApiError(this.getNode(), error as JsonObject, {
        message: `Could not reach Servicely: ${(error as Error)?.message ?? 'network request failed'}`,
        description: `${method} ${endpoint}`,
      });
    }

    if (response.statusCode >= 400) {
      if (isRetryable(response.statusCode) && attempt < maxRetries) {
        // eslint-disable-next-line no-await-in-loop -- backoff before the next attempt
        await sleep(retryAfterDelay(response.headers) ?? backoffDelay(attempt));
        continue;
      }
      throw apiError(this, `${method} ${endpoint}`, response);
    }

    return unwrap(response.body);
  }
}

/**
 * Coerce a list payload into an array. A list endpoint normally answers with
 * `{ data: [...] }`, but an empty or unexpected body must not blow up a caller
 * that is about to iterate.
 */
export function toRecordList<T>(payload: unknown): T[] {
  return Array.isArray(payload) ? (payload as T[]) : [];
}

/**
 * Page through a list endpoint until it stops returning a full page. Servicely
 * has no cursor; `page` is 1-indexed and a short page means the end.
 */
export async function servicelyApiRequestAllItems(
  this: ServicelyContext,
  endpoint: string,
  qs: IDataObject = {},
): Promise<IDataObject[]> {
  const records: IDataObject[] = [];
  let page = 1;

  /* eslint-disable no-await-in-loop -- pagination is inherently sequential */
  for (;;) {
    const data = toRecordList<IDataObject>(
      await servicelyApiRequest.call(this, 'GET', endpoint, undefined, {
        ...qs,
        page,
        page_size: DEFAULT_PAGE_SIZE,
      }),
    );

    if (data.length === 0) {
      return records;
    }
    records.push(...data);
    if (data.length < DEFAULT_PAGE_SIZE) {
      return records;
    }
    page += 1;
  }
  /* eslint-enable no-await-in-loop */
}

// ---------------------------------------------------------------------------
// Query building
// ---------------------------------------------------------------------------

/** Operators that take no value. */
const VALUELESS_OPERATORS: ReadonlySet<QueryOperator> = new Set(['isempty', 'isnotempty']);

/** Operators whose value is a comma-separated list. */
const LIST_OPERATORS: ReadonlySet<QueryOperator> = new Set(['in', 'notIn', 'between']);

/** Strip a single matching pair of surrounding single/double quotes. */
function stripQuotes(token: string): string {
  const quoted =
    token.length >= 2 &&
    ((token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"')));
  return quoted ? token.slice(1, -1) : token;
}

/** Normalize an array's entries to trimmed, non-empty strings. */
function fromArray(values: unknown[]): string[] {
  return values.map((value) => String(value).trim()).filter((value) => value !== '');
}

/** Parse `raw` as a JSON array, tolerating single-quoted entries. */
function tryParseJsonArray(raw: string): unknown[] | undefined {
  for (const candidate of [raw, raw.replace(/'/g, '"')]) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // not JSON in this form; try the next candidate
    }
  }
  return undefined;
}

/**
 * Normalize a list-valued input (the `in`/`notIn`/`between` operators) into
 * string tokens. Accepts a native array, a JSON-array string, or a
 * comma-separated string, since any of those can come out of an expression:
 *
 *   "1, 2, 3"               → ['1', '2', '3']
 *   "[1, 'Option Test', 3]" → ['1', 'Option Test', '3']
 *   ['1', 'Option Test']    → ['1', 'Option Test']
 */
export function parseList(input: unknown): string[] {
  if (Array.isArray(input)) {
    return fromArray(input);
  }
  if (input === null || input === undefined) {
    return [];
  }
  const raw = String(input).trim();
  if (raw === '') {
    return [];
  }
  const jsonArray = tryParseJsonArray(raw);
  if (jsonArray) {
    return fromArray(jsonArray);
  }
  const inner = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;
  return inner
    .split(',')
    .map((part) => stripQuotes(part.trim()))
    .filter((part) => part !== '');
}

/** Convert one simple-mode filter row into a query criterion. */
export function toCriterion(condition: FilterCondition): QueryCriterion {
  const { fieldName } = condition;
  // Only Equals is aliased in the UI (see EQUALS_UI_VALUE).
  const operator = (condition.operator === EQUALS_UI_VALUE ? '=' : condition.operator) as QueryOperator;

  if (VALUELESS_OPERATORS.has(operator)) {
    return { fieldName, operator };
  }
  if (LIST_OPERATORS.has(operator)) {
    return { fieldName, operator, value: parseList(condition.value ?? '') };
  }
  return { fieldName, operator, value: condition.value ?? '' };
}

/** Build an AND query from simple filter rows, ignoring rows with no field. */
export function buildAndQuery(conditions: FilterCondition[]): ServicelyQuery | undefined {
  const criteria = conditions.filter((condition) => condition.fieldName).map(toCriterion);
  return criteria.length > 0 ? { and: criteria } : undefined;
}

/**
 * Parse the advanced Query option, which may arrive as a JSON string or as an
 * already-parsed object (from an expression). Returns `undefined` when empty.
 */
export function parseAdvancedQuery(raw: string | IDataObject | undefined): ServicelyQuery | undefined {
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

/**
 * Field / display-value / relation selectors from the Options collection. Valid
 * on both single-record and list GETs.
 */
export function buildSelectors(ctx: ServicelyContext, itemIndex = 0): IDataObject {
  const qs: IDataObject = {};
  for (const option of ['fields', 'displayValues', 'relations'] as const) {
    const value = nodeParameter(ctx, `options.${option}`, '', itemIndex);
    if (value) {
      qs[option] = value;
    }
  }
  return qs;
}

/**
 * The selectors plus the list-only sort and query parameters. Shared by the
 * node's Get Many and the trigger's Object mode, whose property sets are
 * identical; the advanced Query JSON wins over the Filters rows when both are set.
 */
export function buildListQuery(ctx: ServicelyContext, itemIndex = 0): IDataObject {
  const qs = buildSelectors(ctx, itemIndex);

  const sortField = nodeParameter(ctx, 'options.sortField', '', itemIndex);
  if (sortField) {
    const descending = nodeParameter(ctx, 'options.sortDescending', false, itemIndex);
    qs[descending ? 'order_desc' : 'order'] = sortField;
  }

  const advanced = parseAdvancedQuery(
    nodeParameter<string | IDataObject>(ctx, 'options.query', '', itemIndex),
  );
  const query = advanced ?? buildAndQuery(nodeParameter<FilterCondition[]>(ctx, 'filters.conditions', [], itemIndex));
  if (query) {
    qs.query = JSON.stringify(query);
  }

  return qs;
}
