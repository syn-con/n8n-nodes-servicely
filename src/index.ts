/**
 * Public entry point for the n8n-nodes-servicely package.
 *
 * n8n discovers nodes and credentials via the `n8n` block in package.json;
 * this module re-exports the public type surface and credential class for
 * programmatic consumers and so `main` resolves to a real module.
 */
export * from './types';
export * from './constants';
export { ServicelyApi } from './credentials/ServicelyApi.credentials';
export { Servicely } from './Servicely.node';
export { ApiClient, type ApiClientOptions } from './transport/ApiClient';
export { AuthProvider } from './transport/AuthProvider';
export { RateLimiter, type SleepFn } from './transport/RateLimiter';
export * from './errors';
