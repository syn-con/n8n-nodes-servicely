import {
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  ENDPOINTS,
  QUEUE_IDENTIFIER,
  RESPONSE_HEADERS,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
} from '../constants';
import { mapHttpError, ServicelyNetworkError } from '../errors';
import type {
  AsyncQueueMessage,
  BatchRequest,
  BatchResponse,
  DequeueRequest,
  HttpMethod,
  HttpRequestFn,
  IServicelyClient,
  IServicelyQueueClient,
  ListQueryParams,
  ListResponseMeta,
  QueueReplyRequest,
  RawHttpResponse,
  ServicelyListResult,
  ServicelyRecord,
  AuthConfig,
} from '../types';
import { AuthProvider } from './AuthProvider';
import { RateLimiter, type SleepFn } from './RateLimiter';

type JsonRecord = Record<string, unknown>;

interface InternalRequest {
  method: HttpMethod;
  path: string;
  qs?: Record<string, unknown>;
  body?: unknown;
}

/** Optional resilience/collaborator configuration for the ApiClient. */
export interface ApiClientOptions {
  timeout?: number;
  /** Max retry attempts for 429/5xx/network failures (0 disables retries). */
  maxRetries?: number;
  authProvider?: AuthProvider;
  rateLimiter?: RateLimiter;
  /** Injectable sleep (retry backoff); defaults to setTimeout. */
  sleep?: SleepFn;
}

const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Centralized HTTP client for the Servicely REST API.
 *
 * - Authentication via the injected AuthProvider.
 * - Transport via the injected HttpRequestFn (n8n helper in production, stub in tests).
 * - Unwraps the `{ data: ... }` envelope and maps error responses to typed errors.
 */
export class ApiClient implements IServicelyClient, IServicelyQueueClient {
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly authProvider: AuthProvider;
  private readonly rateLimiter: RateLimiter;
  private readonly sleep: SleepFn;

  constructor(
    baseUrl: string,
    private readonly auth: AuthConfig,
    private readonly http: HttpRequestFn,
    options: ApiClientOptions = {},
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES);
    this.authProvider = options.authProvider ?? new AuthProvider();
    this.rateLimiter = options.rateLimiter ?? new RateLimiter();
    this.sleep = options.sleep ?? defaultSleep;
  }

  async get<T = ServicelyRecord>(table: string, params?: ListQueryParams): Promise<ServicelyListResult<T>> {
    const res = await this.request({ method: 'GET', path: ENDPOINTS.table(table), qs: this.buildQs(params) });
    return { data: this.unwrapList<T>(res.body), meta: this.extractMeta(res.headers) };
  }

  async getOne<T = ServicelyRecord>(table: string, id: string, params?: ListQueryParams): Promise<T> {
    const res = await this.request({ method: 'GET', path: ENDPOINTS.record(table, id), qs: this.buildQs(params) });
    return this.unwrapSingle<T>(res.body);
  }

  async create<T = ServicelyRecord>(table: string, data: JsonRecord): Promise<T> {
    const res = await this.request({ method: 'POST', path: ENDPOINTS.table(table), body: data });
    return this.unwrapSingle<T>(res.body);
  }

  async update<T = ServicelyRecord>(table: string, id: string, data: JsonRecord): Promise<T> {
    const res = await this.request({ method: 'PATCH', path: ENDPOINTS.record(table, id), body: data });
    return this.unwrapSingle<T>(res.body);
  }

  async replace<T = ServicelyRecord>(table: string, id: string, data: JsonRecord): Promise<T> {
    const res = await this.request({ method: 'PUT', path: ENDPOINTS.record(table, id), body: data });
    return this.unwrapSingle<T>(res.body);
  }

  async delete(table: string, id: string): Promise<void> {
    await this.request({ method: 'DELETE', path: ENDPOINTS.record(table, id) });
  }

  async batch(requests: BatchRequest[]): Promise<BatchResponse> {
    const body = { id: `n8n-batch-${Date.now()}`, requests };
    const res = await this.request({ method: 'POST', path: ENDPOINTS.batch, body });
    return res.body as BatchResponse;
  }

  /** Claim messages from a Servicely Async Integration queue (`action: dequeue`). */
  async dequeue(request: DequeueRequest): Promise<AsyncQueueMessage[]> {
    const body = {
      action: 'dequeue',
      identifier: QUEUE_IDENTIFIER,
      queue: request.queue,
      subject: request.subject,
      request_count: request.requestCount,
    };
    const res = await this.request({ method: 'POST', path: ENDPOINTS.asyncIntegration, body });
    return this.unwrapList<AsyncQueueMessage>(res.body);
  }

  /** Acknowledge a claimed message back to Servicely (success or failure). */
  async reply(request: QueueReplyRequest): Promise<void> {
    const body = {
      reply_to: request.replyTo,
      action: request.action,
      identifier: QUEUE_IDENTIFIER,
      status: request.status,
      payload: request.payload,
    };
    await this.request({ method: 'POST', path: ENDPOINTS.asyncIntegration, body });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async request(opts: InternalRequest): Promise<RawHttpResponse> {
    const url = `${this.baseUrl}${opts.path}`;
    const bodyString = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;

    const authHeaders = this.authProvider.buildHeaders(this.auth, {
      method: opts.method,
      path: opts.path,
      contentType: 'application/json',
      body: bodyString,
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...authHeaders,
    };

    // Auth headers (esp. HMAC's Date/Content-MD5) are recomputed per attempt.
    for (let attempt = 0; ; attempt++) {
      // eslint-disable-next-line no-await-in-loop -- one attempt must finish before the next
      await this.rateLimiter.waitIfNeeded();

      let res: RawHttpResponse;
      try {
        // eslint-disable-next-line no-await-in-loop -- retries are inherently sequential
        res = await this.http({ method: opts.method, url, headers, qs: opts.qs, body: opts.body, timeout: this.timeout });
      } catch (networkError) {
        if (attempt < this.maxRetries) {
          // eslint-disable-next-line no-await-in-loop -- backoff before the next attempt
          await this.sleep(this.backoffDelay(attempt));
          continue;
        }
        throw new ServicelyNetworkError((networkError as Error)?.message ?? 'Network request failed', opts.path);
      }

      this.rateLimiter.recordCost(this.readIntHeader(res.headers, RESPONSE_HEADERS.rateLimitCost));

      if (res.statusCode >= 400) {
        if (this.isRetryable(res.statusCode) && attempt < this.maxRetries) {
          const retryAfterMs = this.readRetryAfter(res.headers);
          // eslint-disable-next-line no-await-in-loop -- backoff before the next attempt
          await this.sleep(retryAfterMs ?? this.backoffDelay(attempt));
          continue;
        }
        throw mapHttpError(res.statusCode, this.extractErrors(res.body), opts.path);
      }
      return res;
    }
  }

  /** Retry transient failures only: 429 (rate limit) and 5xx (server). Never 4xx client errors. */
  private isRetryable(statusCode: number): boolean {
    return statusCode === 429 || statusCode >= 500;
  }

  /** Exponential backoff with full jitter, capped at RETRY_MAX_DELAY_MS. */
  private backoffDelay(attempt: number): number {
    const exponential = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** attempt);
    return Math.floor(Math.random() * exponential);
  }

  /** Parse `Retry-After` (seconds, or an HTTP date) into milliseconds, if present. */
  private readRetryAfter(headers: RawHttpResponse['headers']): number | undefined {
    const raw = this.readHeader(headers, 'retry-after');
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

  private readHeader(headers: RawHttpResponse['headers'], name: string): string | undefined {
    const value = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  }

  private readIntHeader(headers: RawHttpResponse['headers'], name: string): number | undefined {
    const raw = this.readHeader(headers, name);
    if (raw === undefined) {
      return undefined;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  /** Serialize ListQueryParams into a query-string object (JSON-encoding `query`). */
  private buildQs(params?: ListQueryParams): Record<string, unknown> | undefined {
    if (!params) {
      return undefined;
    }
    const qs: Record<string, unknown> = {};
    if (params.fields) { qs.fields = params.fields; }
    if (params.displayValues) { qs.displayValues = params.displayValues; }
    if (params.relations) { qs.relations = params.relations; }
    if (params.page !== undefined) { qs.page = params.page; }
    if (params.page_size !== undefined) { qs.page_size = params.page_size; }
    if (params.order) { qs.order = params.order; }
    if (params.order_desc) { qs.order_desc = params.order_desc; }
    if (params.query) { qs.query = JSON.stringify(params.query); }
    return Object.keys(qs).length > 0 ? qs : undefined;
  }

  private asObject(body: unknown): JsonRecord | undefined {
    if (typeof body === 'string') {
      try {
        return JSON.parse(body) as JsonRecord;
      } catch {
        return undefined;
      }
    }
    return body !== null && typeof body === 'object' ? (body as JsonRecord) : undefined;
  }

  private unwrapList<T>(body: unknown): T[] {
    const obj = this.asObject(body);
    if (obj && Array.isArray(obj.data)) {
      return obj.data as T[];
    }
    return Array.isArray(body) ? (body as T[]) : [];
  }

  private unwrapSingle<T>(body: unknown): T {
    const obj = this.asObject(body);
    if (obj && 'data' in obj) {
      return obj.data as T;
    }
    return body as T;
  }

  /** Pull error messages out of `{ errors: { request: [...], <field>: [...] } }`. */
  private extractErrors(body: unknown): string[] {
    const obj = this.asObject(body);
    const errors = obj?.errors;
    if (!errors || typeof errors !== 'object') {
      return [];
    }
    const messages: string[] = [];
    for (const value of Object.values(errors as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        messages.push(...value.filter((v): v is string => typeof v === 'string'));
      }
    }
    return messages;
  }

  private extractMeta(headers: RawHttpResponse['headers']): ListResponseMeta {
    return {
      page: this.readIntHeader(headers, RESPONSE_HEADERS.page),
      pageSize: this.readIntHeader(headers, RESPONSE_HEADERS.pageSize),
      resultCount: this.readIntHeader(headers, RESPONSE_HEADERS.resultCount),
      totalResultCount: this.readIntHeader(headers, RESPONSE_HEADERS.totalResultCount),
      hasMore: this.readHeader(headers, RESPONSE_HEADERS.resultMore) === 'true',
      rateLimitCost: this.readIntHeader(headers, RESPONSE_HEADERS.rateLimitCost),
    };
  }
}
