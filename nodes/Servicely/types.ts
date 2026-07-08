/**
 * Shared type contracts for the Servicely JSON REST API (v1).
 *
 * These mirror the API surface documented at
 * https://docs-servicely.atlassian.net/wiki/spaces/SD/pages/2077523978
 * and are the single, authoritative representation of the data model (DRY).
 */

// ---------------------------------------------------------------------------
// Records & response envelopes
// ---------------------------------------------------------------------------

/** Any Servicely table record. Always carries an `id`; other fields are dynamic. */
export interface ServicelyRecord {
  id: string;
  [field: string]: unknown;
}

/**
 * A field returned with `displayValues` requested — the raw stored value plus
 * its human-readable display value.
 */
export interface DisplayValue {
  value: string;
  displayValue: string;
}

/** Servicely wraps list results in a `{ data: [...] }` envelope. */
export interface ServicelyListResponse<T = ServicelyRecord> {
  data: T[];
}

/** Servicely wraps single-record results in a `{ data: {...} }` envelope. */
export interface ServicelySingleResponse<T = ServicelyRecord> {
  data: T;
}

/**
 * Error envelope returned on validation/permission failures, e.g.
 * `{ "errors": { "request": ["CUSTOM-40006: ..."] } }`.
 */
export interface ServicelyErrorResponse {
  errors: {
    request?: string[];
    [field: string]: string[] | undefined;
  };
}

// ---------------------------------------------------------------------------
// Querying
// ---------------------------------------------------------------------------

/** Comparison/match operators supported by the `query` parameter. */
export type QueryOperator =
  | '='
  | '!='
  | 'startswith'
  | 'contains'
  | 'doesnotcontain'
  | 'isempty'
  | 'isnotempty'
  | 'in'
  | 'notIn'
  | '<'
  | '>'
  | '<='
  | '>='
  | 'between';

/** A single query condition. `fieldName` may dot-walk relations (e.g. `Manager.Email`). */
export interface QueryCriterion {
  fieldName: string;
  operator: QueryOperator;
  value?: unknown;
}

/** A boolean grouping of criteria/nested groups. */
export interface QueryConjunction {
  and?: Array<QueryCriterion | QueryConjunction>;
  or?: Array<QueryCriterion | QueryConjunction>;
  nor?: Array<QueryCriterion | QueryConjunction>;
}

/** Top-level complex query passed (JSON-encoded) as the `query` parameter. */
export type ServicelyQuery = QueryConjunction;

/** Query-string parameters accepted by GET list/single endpoints. */
export interface ListQueryParams {
  /** Comma-delimited field names to return. */
  fields?: string;
  /** Comma-delimited fields to return as `{ value, displayValue }`. */
  displayValues?: string;
  /** Comma-delimited dot-walked relation names. */
  relations?: string;
  /** Complex JSON query (serialized when sent). */
  query?: ServicelyQuery;
  /** 1-indexed page number. */
  page?: number;
  /** Records per page (API default 200). */
  page_size?: number;
  /** Field to sort ascending. */
  order?: string;
  /** Field to sort descending. */
  order_desc?: string;
}

/** Pagination/metadata extracted from `X-*` response headers. */
export interface ListResponseMeta {
  page?: number;
  pageSize?: number;
  resultCount?: number;
  totalResultCount?: number;
  hasMore: boolean;
  rateLimitCost?: number;
}

// ---------------------------------------------------------------------------
// Batch API (POST /v1/_batch, requires Servicely 1.4.2+)
// ---------------------------------------------------------------------------

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface BatchRequest {
  id: string;
  method: HttpMethod;
  url: string;
  body?: string | null;
}

export interface BatchSubResponse {
  id: string;
  body: string;
  execution_time: number;
  status_code: number;
  status_text: string;
}

export interface BatchResponse {
  id: string;
  requests: BatchSubResponse[];
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

export type AuthMethod = 'basic' | 'bearer' | 'hmac';

/** Decrypted credential shape consumed by the transport layer. */
export interface AuthConfig {
  method: AuthMethod;
  username?: string;
  password?: string;
  apiToken?: string;
  sharedSecret?: string;
}

/** Full decrypted `servicelyApi` credential, including the target instance URL. */
export interface ServicelyCredentials extends AuthConfig {
  instanceUrl: string;
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/**
 * Fields on an `Attachment` table record. `ParentRecord` uses the
 * `{recordId}:{tableName}` format (e.g. `abc123:Incident`).
 */
export interface AttachmentRecord extends ServicelyRecord {
  MimeType: string;
  FileName: string;
  Data?: string;
  RelatedField: string;
  ParentRecord: string;
}

// ---------------------------------------------------------------------------
// Async Integration queue (POST {instanceUrl}/controller/AsyncIntegration)
// ---------------------------------------------------------------------------

/**
 * A single message claimed from a Servicely async queue. Always carries an
 * `id` (used as `reply_to` when acknowledging); `payload` is an opaque value
 * that is often a JSON object/array encoded as a string.
 */
export interface AsyncQueueMessage {
  id: string;
  payload?: unknown;
  [field: string]: unknown;
}

/** Parameters for a `dequeue` action against the Async Integration controller. */
export interface DequeueRequest {
  /** Queue name to claim messages from. */
  queue: string;
  /** Action/subject filter identifying the messages to claim. */
  subject: string;
  /** Maximum number of messages to claim in one call. */
  requestCount: number;
}

/**
 * Acknowledgement of a claimed message. `action`/`status` distinguish a
 * successful (`success`/`ok`) from a failed (`fail`/`error`) outcome, matching
 * the Async Integration reply contract.
 */
export interface QueueReplyRequest {
  /** The claimed message id (its `reply_to`). */
  replyTo: string;
  action: 'success' | 'fail';
  status: 'ok' | 'error';
  /** Response payload returned to Servicely with the acknowledgement. */
  payload: unknown;
}

/**
 * Async-queue surface of the transport, kept separate from the CRUD client
 * (ISP) so queue consumers depend only on what they use.
 */
export interface IServicelyQueueClient {
  dequeue(request: DequeueRequest): Promise<AsyncQueueMessage[]>;
  reply(request: QueueReplyRequest): Promise<void>;
}

// ---------------------------------------------------------------------------
// Transport abstraction
// ---------------------------------------------------------------------------

/** A single outbound HTTP request, independent of any framework. */
export interface HttpRequestSpec {
  method: HttpMethod;
  /** Fully-qualified URL. */
  url: string;
  headers?: Record<string, string>;
  qs?: Record<string, unknown>;
  body?: unknown;
  timeout?: number;
}

/** Normalized HTTP response that does NOT throw on non-2xx (status is inspected). */
export interface RawHttpResponse<T = unknown> {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: T;
}

/**
 * Injected transport function. The n8n adapter (in the node) wraps
 * `this.helpers.httpRequest`; tests pass a stub. Keeps ApiClient framework-free.
 */
export type HttpRequestFn = (spec: HttpRequestSpec) => Promise<RawHttpResponse>;

/** Details required to compute an HMAC signature for a request. */
export interface RequestSigningDetails {
  method: HttpMethod;
  /** URL path used in the HMAC string-to-sign. */
  path: string;
  contentType?: string;
  /** Serialized request body, used for the Content-MD5 digest. */
  body?: string;
}

/** Result of a list query: the records plus pagination metadata from headers. */
export interface ServicelyListResult<T = ServicelyRecord> {
  data: T[];
  meta: ListResponseMeta;
}

/**
 * Abstraction handlers depend on (DIP) rather than the concrete ApiClient.
 * One focused CRUD + batch surface; attachments are Attachment-table records,
 * so they reuse these methods.
 */
export interface IServicelyClient {
  get<T = ServicelyRecord>(table: string, params?: ListQueryParams): Promise<ServicelyListResult<T>>;
  getOne<T = ServicelyRecord>(table: string, id: string, params?: ListQueryParams): Promise<T>;
  create<T = ServicelyRecord>(table: string, data: Record<string, unknown>): Promise<T>;
  update<T = ServicelyRecord>(table: string, id: string, data: Record<string, unknown>): Promise<T>;
  replace<T = ServicelyRecord>(table: string, id: string, data: Record<string, unknown>): Promise<T>;
  delete(table: string, id: string): Promise<void>;
  batch(requests: BatchRequest[]): Promise<BatchResponse>;
}
