import {
  type IDataObject,
  type IExecuteFunctions,
  type IHookFunctions,
  type IHttpRequestMethods,
  type IHttpRequestOptions,
  type ILoadOptionsFunctions,
  type INodeExecutionData,
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
 * trigger, the design-time load-options / list-search context, and the webhook
 * lifecycle hooks that register the AI Tool. All of them can call
 * `helpers.httpRequestWithAuthentication`, which is all these helpers need.
 */
export type ServicelyContext =
  | IExecuteFunctions
  | IHookFunctions
  | ILoadOptionsFunctions
  | IPollFunctions;

/**
 * Field-value pair emitted by the `fieldsToSet` fixedCollection. `name` is a
 * Field locator, so it is either the raw `{__rl, mode, value}` object or a plain
 * string (see `fieldRef`).
 */
interface FieldEntry {
  name: string | IDataObject;
  value: string;
}

/** Read a plain string parameter (a record id typed by hand or from an expression). */
export function stringParam(ctx: IExecuteFunctions, name: string, index: number): string {
  return String(ctx.getNodeParameter(name, index, '') ?? '').trim();
}

/** Read a resourceLocator's resolved value (table name, record id, ...). */
export function locator(ctx: IExecuteFunctions, name: string, index: number): string {
  return ctx.getNodeParameter(name, index, '', { extractValue: true }) as string;
}
/**
 * Read what a resourceLocator *shows* rather than what it stores. The Table
 * picker stores a `TableDefinition` row id, while `/v1/{table}` needs the API
 * table name, and the name is what n8n cached alongside the id when the entry
 * was picked from the list.
 *
 * Everything else resolves to itself: a locator in "By Name" mode holds the name
 * in `value` with nothing cached, and a plain string is what an expression
 * produces and what workflows saved before the locator existed still hold — same
 * reasoning as `fieldRef`, so none of them needs migrating.
 */
export function locatorLabel(ctx: IExecuteFunctions, name: string, index: number): string {
  const label = ctx.getNodeParameter(name, index, '', { extractValue: false });
  if (label === null || typeof label !== 'object') {
    return label === undefined ? '' : String(label).trim();
  }
  const { cachedResultName, value } = label as IDataObject;
  return String(cachedResultName ?? value ?? '').trim();
}

/**
 * A field reference stored in a fixedCollection row. n8n's `extractValue` does
 * not reach inside collections, so a Field locator arrives as its raw
 * `{__rl, mode, value}` object; rows saved before the locator existed (and
 * anything coming from an expression) arrive as a plain string. Both resolve to
 * the same field name here, so no workflow needs migrating.
 */
export function fieldRef(value: unknown): string {
  if (value !== null && typeof value === 'object') {
    return String((value as IDataObject).value ?? '').trim();
  }
  return value === null || value === undefined ? '' : String(value).trim();
}

/** Collapse the `fieldsToSet` rows into the record body to write. */
export function fieldsToSet(ctx: IExecuteFunctions, index: number): IDataObject {
  const entries = ctx.getNodeParameter('fieldsToSet.field', index, []) as FieldEntry[];
  const data: IDataObject = {};
  for (const entry of entries) {
    const name = fieldRef(entry.name);
    if (name) {
      data[name] = entry.value;
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
      // Retries are inherently sequential
      response = (await this.helpers.httpRequestWithAuthentication.call(
        this,
        'servicelyApi',
        options,
      )) as FullResponse;
    } catch (error) {
      if (attempt < maxRetries) {
        // Backoff before the next attempt
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
        // Backoff before the next attempt
        await sleep(retryAfterDelay(response.headers) ?? backoffDelay(attempt));
        continue;
      }
      throw apiError(this, `${method} ${endpoint}`, response);
    }

    return unwrap(response.body);
  }
}

/**
 * Runs one request and answers its failure instead of throwing it, so a caller that
 * expects one particular failure — a 404 for a row or a table that is not there, a
 * page that cannot be read — decides what it means outside a catch block, and lets
 * everything else through as it came. What comes through is already a `NodeApiError`
 * carrying the API's own message, so nothing here re-wraps it.
 */
export async function attempt<T>(
  run: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; failure: unknown }> {
  try {
    return { ok: true, value: await run() };
  } catch (failure) {
    return { ok: false, failure };
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
 * Output items for a controller response, which is free-form: a controller may
 * answer with a record, a list, a scalar, or nothing at all. A list fans out to
 * one item per entry (the usual n8n shape); anything that is not an object is
 * wrapped so downstream nodes still see JSON. Shared by Controller → Call and
 * the Global Search operations, which post to controllers rather than to `/v1`.
 */
export function toItems(payload: unknown, index: number): INodeExecutionData[] {
  const pairedItem = { item: index };

  if (Array.isArray(payload)) {
    return payload.map((entry) => ({
      json: (entry !== null && typeof entry === 'object' ? entry : { data: entry }) as IDataObject,
      pairedItem,
    }));
  }
  if (payload === null || payload === undefined || payload === '') {
    return [{ json: { success: true }, pairedItem }];
  }
  if (typeof payload !== 'object') {
    return [{ json: { data: payload }, pairedItem }];
  }
  return [{ json: payload as IDataObject, pairedItem }];
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

  // Pagination is inherently sequential
  for (; ;) {
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
  const fieldName = fieldRef(condition.fieldName);
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
  const criteria = conditions.filter((condition) => fieldRef(condition.fieldName)).map(toCriterion);
  return criteria.length > 0 ? { and: criteria } : undefined;
}

/**
 * Parse the advanced Query option, which may arrive as a JSON string or as an
 * already-parsed object (from an expression). Returns `undefined` when empty.
 */
/** `JSON.parse` that answers the parse failure instead of throwing it. */
function parseJson(text: string): { value: unknown } | { error: string } {
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export function parseAdvancedQuery(raw: string | IDataObject | undefined): ServicelyQuery | undefined {
  if (!raw || (typeof raw === 'string' && raw.trim() === '')) {
    return undefined;
  }
  if (typeof raw !== 'string') {
    return raw as ServicelyQuery;
  }
  const parsed = parseJson(raw);
  if ('error' in parsed) {
    // Thrown outside the parse, and plain: router.ts wraps whatever an operation
    // throws in a NodeOperationError carrying the node, so this is what the user reads
    throw new Error(`Invalid Query JSON: ${parsed.error}`);
  }
  return parsed.value as ServicelyQuery;
}

/**
 * One selector as the API takes it: a comma-separated list. The Fields and
 * Display Value Fields dropdowns hand over an array of field names, while
 * Relation Fields — and every workflow saved before those dropdowns existed, or
 * any of the three driven by an expression — hands over a string, so both shapes
 * collapse here and nothing needs migrating.
 */
function selectorList(value: unknown): string {
  const parts = Array.isArray(value) ? value : String(value ?? '').split(',');
  return parts
    .map((part) => String(part).trim())
    .filter((part) => part !== '')
    .join(',');
}

/**
 * Field / display-value / relation selectors from the Options collection. Valid
 * on both single-record and list GETs.
 */
export function buildSelectors(ctx: ServicelyContext, itemIndex = 0): IDataObject {
  const qs: IDataObject = {};
  for (const option of ['fields', 'displayValues', 'relations'] as const) {
    const value = selectorList(nodeParameter<unknown>(ctx, `options.${option}`, '', itemIndex));
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

  const sortField = String(nodeParameter(ctx, 'options.sortField', '', itemIndex) ?? '').trim();
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
