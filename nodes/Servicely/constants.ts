/** API-level literals shared by the nodes and their property descriptions. */

import type { QueryOperator } from './types';

/** Page size used when paging through all results (matches the API default). */
export const DEFAULT_PAGE_SIZE = 200;

/** Controller endpoints live at the instance root, not under /v1. */
export const CONTROLLER_PATH_PREFIX = '/controller';

/** Async Integration queue controller (dequeue/reply). Not versioned under /v1. */
export const ASYNC_INTEGRATION_PATH = `${CONTROLLER_PATH_PREFIX}/AsyncIntegration`;

/** Table listing the instance's controllers (backs the Controller picker). */
export const CONTROLLER_TABLE = 'SystemController';

/** Global Search controller (searchable-table config + the searches themselves). */
export const GLOBAL_SEARCH_PATH = `${CONTROLLER_PATH_PREFIX}/GlobalSearch`;

/**
 * `request_type` values the Global Search controller discriminates on: its own
 * configuration (one entry per searchable table, which is what the Table picker
 * lists), a search, and a capped batch search.
 */
export const GLOBAL_SEARCH_REQUESTS = {
  config: 'search_config',
  search: 'search',
  batch: 'batch_search',
} as const;

/** One of the `request_type` values above. */
export type GlobalSearchRequestType = (typeof GLOBAL_SEARCH_REQUESTS)[keyof typeof GLOBAL_SEARCH_REQUESTS];

/** Identifier sent as the `identifier` field on Async Integration queue calls. */
export const QUEUE_IDENTIFIER = 'n8n';

/** Default number of messages to claim per dequeue poll. */
export const DEFAULT_DEQUEUE_COUNT = 10;

/** Default request timeout in milliseconds (overridable via Request Options). */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Default max retry attempts for 429/5xx/network failures (overridable via Request Options). */
export const DEFAULT_MAX_RETRIES = 3;

/** Backoff bounds for retried requests (exponential + jitter). */
export const RETRY_BASE_DELAY_MS = 500;
export const RETRY_MAX_DELAY_MS = 8_000;

/**
 * UI value for the Equals operator. n8n treats any options value starting with
 * `=` as an expression, so `=` cannot itself be an options value — the dropdown
 * would render it as an empty expression and never stay selected. The Operator
 * dropdown stores `eq`, which the query builder translates back to `=`.
 */
export const EQUALS_UI_VALUE = 'eq';

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
