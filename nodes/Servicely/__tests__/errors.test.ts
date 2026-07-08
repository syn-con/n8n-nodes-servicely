import { describe, expect, it } from 'vitest';

import {
  mapHttpError,
  ServicelyAuthError,
  ServicelyBusinessError,
  ServicelyError,
  ServicelyNetworkError,
  ServicelyNotFoundError,
  ServicelyRateLimitError,
  ServicelyServerError,
  ServicelyValidationError,
} from '../errors';

describe('mapHttpError', () => {
  it.each([
    [400, ServicelyValidationError],
    [401, ServicelyAuthError],
    [404, ServicelyNotFoundError],
    [422, ServicelyBusinessError],
    [429, ServicelyRateLimitError],
  ])('maps %i to the right typed error', (status, Type) => {
    const err = mapHttpError(status, ['boom'], '/v1/X');
    expect(err).toBeInstanceOf(Type);
    expect(err.statusCode).toBe(status);
    expect(err.message).toBe('boom');
    expect(err.endpoint).toBe('/v1/X');
  });

  it('maps unmapped statuses (e.g. 502) to a server error', () => {
    const err = mapHttpError(502, [], '/v1/X');
    expect(err).toBeInstanceOf(ServicelyServerError);
    expect(err.statusCode).toBe(502);
  });

  it('joins multiple messages and falls back to a generic message', () => {
    expect(mapHttpError(429, ['a', 'b'], '/v1/X').message).toBe('a; b');
    expect(mapHttpError(418, [], '/v1/X').message).toMatch(/HTTP 418/);
  });
});

describe('error types', () => {
  it('all subclasses are ServicelyError instances with the right name', () => {
    const err = new ServicelyServerError('x', 500, [], '/v1/X');
    expect(err).toBeInstanceOf(ServicelyError);
    expect(err.name).toBe('ServicelyServerError');
  });

  it('ServicelyNetworkError has status 0 and prefixes the cause', () => {
    const err = new ServicelyNetworkError('ECONNRESET', '/v1/X');
    expect(err.statusCode).toBe(0);
    expect(err.message).toMatch(/Could not reach Servicely: ECONNRESET/);
    expect(err.errors).toEqual(['ECONNRESET']);
  });
});
