/**
 * Public entry point for the @synergyconsulting/n8n-nodes-servicely package.
 *
 * n8n discovers nodes and credentials via the `n8n` block in package.json; this
 * module exists so `main` resolves to a real module and re-exports the node and
 * credential classes for programmatic consumers.
 */
export { ServicelyApi } from './credentials/ServicelyApi.credentials';
export { ServicelySoFiAIWebhookAuthApi } from './credentials/ServicelySoFiAIWebhookAuthApi.credentials';
export { Servicely } from './nodes/Servicely/Servicely.node';
export { ServicelyTrigger } from './nodes/Servicely/ServicelyTrigger.node';
export { ServicelySoFiAIWebhookTrigger } from './nodes/ServicelySoFiAIWebhook/ServicelySoFiAIWebhookTrigger.node';
export * from './nodes/Servicely/types';
