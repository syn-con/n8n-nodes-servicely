/**
 * Domain-specific error hierarchy for Servicely API failures.
 *
 * Framework-agnostic: these carry the status code, the API's own error
 * messages, and the endpoint. The node boundary wraps them in n8n's
 * NodeOperationError for display.
 */

/** Base class for all Servicely API errors. */
export class ServicelyError extends Error {
  readonly statusCode: number;
  readonly errors: string[];
  readonly endpoint: string;

  constructor(message: string, statusCode: number, errors: string[], endpoint: string) {
    super(message);
    this.name = 'ServicelyError';
    this.statusCode = statusCode;
    this.errors = errors;
    this.endpoint = endpoint;
    // Restore the prototype chain (required when extending built-ins under ES2020).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 400 — request/field validation failed. */
export class ServicelyValidationError extends ServicelyError {
  constructor(message: string, errors: string[], endpoint: string) {
    super(message, 400, errors, endpoint);
    this.name = 'ServicelyValidationError';
  }
}

/** 401 — authentication failed. */
export class ServicelyAuthError extends ServicelyError {
  constructor(message: string, errors: string[], endpoint: string) {
    super(message, 401, errors, endpoint);
    this.name = 'ServicelyAuthError';
  }
}

/** 404 — record or endpoint not found. */
export class ServicelyNotFoundError extends ServicelyError {
  constructor(message: string, errors: string[], endpoint: string) {
    super(message, 404, errors, endpoint);
    this.name = 'ServicelyNotFoundError';
  }
}

/** 422 — blocked by validation/permission/business rules. */
export class ServicelyBusinessError extends ServicelyError {
  constructor(message: string, errors: string[], endpoint: string) {
    super(message, 422, errors, endpoint);
    this.name = 'ServicelyBusinessError';
  }
}

/** 429 — rate limited. */
export class ServicelyRateLimitError extends ServicelyError {
  constructor(message: string, errors: string[], endpoint: string) {
    super(message, 429, errors, endpoint);
    this.name = 'ServicelyRateLimitError';
  }
}

/** 5xx (or otherwise unmapped) — server-side failure. */
export class ServicelyServerError extends ServicelyError {
  constructor(message: string, statusCode: number, errors: string[], endpoint: string) {
    super(message, statusCode, errors, endpoint);
    this.name = 'ServicelyServerError';
  }
}

/** Transport failure with no HTTP response (connection refused, DNS, timeout). */
export class ServicelyNetworkError extends ServicelyError {
  constructor(message: string, endpoint: string) {
    super(`Could not reach Servicely: ${message}`, 0, [message], endpoint);
    this.name = 'ServicelyNetworkError';
  }
}

/** Human-readable fallbacks when the API returns no error body. */
const DEFAULT_MESSAGES: Record<number, string> = {
  400: 'Request validation failed.',
  401: 'Authentication failed. Verify your API token / credentials and instance URL.',
  404: 'Record not found. Check the table name and Record ID.',
  422: 'Operation blocked by validation, permissions, or business rules.',
  429: 'Rate limit exceeded. Too many requests.',
};

/** Map an HTTP status + parsed error messages onto a typed ServicelyError. */
export function mapHttpError(statusCode: number, errors: string[], endpoint: string): ServicelyError {
  const message = errors.length > 0 ? errors.join('; ') : (DEFAULT_MESSAGES[statusCode] ?? `Servicely request failed (HTTP ${statusCode}).`);

  switch (statusCode) {
    case 400:
      return new ServicelyValidationError(message, errors, endpoint);
    case 401:
      return new ServicelyAuthError(message, errors, endpoint);
    case 404:
      return new ServicelyNotFoundError(message, errors, endpoint);
    case 422:
      return new ServicelyBusinessError(message, errors, endpoint);
    case 429:
      return new ServicelyRateLimitError(message, errors, endpoint);
    default:
      return new ServicelyServerError(message, statusCode, errors, endpoint);
  }
}
