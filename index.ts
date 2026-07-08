/**
 * Public entry point for the n8n-nodes-servicely package.
 *
 * n8n discovers nodes and credentials via the `n8n` block in package.json;
 * this module re-exports the public type surface and credential class for
 * programmatic consumers and so `main` resolves to a real module.
 */
export * from './nodes/Servicely/types';
export * from './nodes/Servicely/constants';
export { ServicelyApi } from './credentials/ServicelyApi.credentials';
export { Servicely } from './nodes/Servicely/Servicely.node';
export { ServicelyTrigger } from './nodes/Servicely/ServicelyTrigger.node';
export { ApiClient, type ApiClientOptions } from './nodes/Servicely/transport/ApiClient';
export { AuthProvider } from './nodes/Servicely/transport/AuthProvider';
export { RateLimiter, type SleepFn } from './nodes/Servicely/transport/RateLimiter';
export * from './nodes/Servicely/errors';
