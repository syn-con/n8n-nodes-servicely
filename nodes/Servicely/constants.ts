/**
 * Single source of truth for API-level string literals (DRY).
 * No endpoint path, operator, or header name should be hard-coded elsewhere.
 */

import type { QueryOperator } from './types';

/** API version segment of every request path. */
export const API_VERSION = 'v1';

/** API default page size for list endpoints. */
export const DEFAULT_PAGE_SIZE = 200;

/** Default request timeout in milliseconds (overridable via node options). */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Default max retry attempts for 429/5xx/network failures (overridable via node options). */
export const DEFAULT_MAX_RETRIES = 3;

/** Backoff bounds for retried requests (exponential + jitter). */
export const RETRY_BASE_DELAY_MS = 500;
export const RETRY_MAX_DELAY_MS = 8_000;

/**
 * Soft self-throttle budget for the token-bucket RateLimiter. Servicely does not
 * publish a documented cost budget/window, so these are conservative defaults
 * sized off the observed `X-Rate-Limit-Cost` example (~11 per 200-record page);
 * the limiter self-corrects from real `X-Rate-Limit-Cost` values as they arrive.
 */
export const DEFAULT_RATE_LIMIT_CAPACITY = 200;
export const DEFAULT_RATE_LIMIT_REFILL_PER_SECOND = 20;

/** Path builders for the REST surface. All paths are relative to the instance URL. */
export const ENDPOINTS = {
  table: (table: string): string => `/${API_VERSION}/${table}`,
  record: (table: string, id: string): string => `/${API_VERSION}/${table}/${id}`,
  batch: `/${API_VERSION}/_batch`,
  attachment: (id: string): string => `/${API_VERSION}/Attachment/${id}`,
  attachmentList: `/${API_VERSION}/Attachment`,
} as const;

/** Supported query operators (verified against the GET Request docs). */
export const QUERY_OPERATORS: readonly QueryOperator[] = [
  '=',
  '!=',
  'startswith',
  'contains',
  'doesnotcontain',
  'isempty',
  'isnotempty',
  'in',
  'notIn',
  '<',
  '>',
  '<=',
  '>=',
  'between',
] as const;

/** Supported boolean conjunctions for complex queries. */
export const CONJUNCTIONS = ['and', 'or', 'nor'] as const;

/** Response header names returned by list endpoints. */
export const RESPONSE_HEADERS = {
  page: 'x-page',
  pageSize: 'x-page-size',
  resultCount: 'x-result-count',
  resultMore: 'x-result-more',
  totalResultCount: 'x-total-result-count',
  rateLimitCost: 'x-rate-limit-cost',
} as const;

/** Minimum Servicely versions for optional features (for README/runtime notes). */
export const MIN_VERSIONS = {
  batch: '1.4.2-release.40',
  bearerUrlParam: '1.10',
  moveAttachments: '1.10',
} as const;
