import type {
  IDataObject,
  IExecuteFunctions,
  IHttpRequestMethods,
  ILoadOptionsFunctions,
  IPollFunctions,
} from 'n8n-workflow';

import { ApiClient } from './ApiClient';
import type { AuthConfig, AuthMethod, HttpRequestFn } from '../types';

/**
 * n8n contexts that can build a Servicely client: the execution context, the
 * polling-trigger context, and the design-time load-options / list-search
 * context. All expose `getCredentials` and `helpers.httpRequest`, which is all
 * the transport layer needs.
 */
export type ClientContext = IExecuteFunctions | ILoadOptionsFunctions | IPollFunctions;

/** Adapt n8n's httpRequest helper to the framework-agnostic HttpRequestFn. */
export function makeHttpFn(ctx: ClientContext): HttpRequestFn {
  return async (spec) => {
    const response = await ctx.helpers.httpRequest({
      method: spec.method as IHttpRequestMethods,
      url: spec.url,
      headers: spec.headers,
      qs: spec.qs as IDataObject,
      body: spec.body as IDataObject | undefined,
      json: true,
      returnFullResponse: true,
      ignoreHttpStatusErrors: true,
      timeout: spec.timeout,
    });
    return {
      statusCode: response.statusCode,
      headers: response.headers as Record<string, string | string[] | undefined>,
      body: response.body,
    };
  };
}

function buildAuthConfig(credentials: IDataObject): AuthConfig {
  return {
    method: credentials.authMethod as AuthMethod,
    username: credentials.username as string | undefined,
    password: credentials.password as string | undefined,
    apiToken: credentials.apiToken as string | undefined,
    sharedSecret: credentials.sharedSecret as string | undefined,
  };
}

/** Resilience overrides read from the node's Request Options. */
export interface BuildClientOptions {
  timeout?: number;
  maxRetries?: number;
}

/**
 * Read the `servicelyApi` credential and construct an ApiClient. Usable from
 * both `execute` and load-options/list-search methods (DRY) so dynamic pickers
 * and the runtime share one transport configuration.
 */
export async function buildClient(ctx: ClientContext, options: BuildClientOptions = {}): Promise<ApiClient> {
  const credentials = (await ctx.getCredentials('servicelyApi')) as IDataObject;
  const auth = buildAuthConfig(credentials);
  const baseUrl = String(credentials.instanceUrl ?? '').trim();
  return new ApiClient(baseUrl, auth, makeHttpFn(ctx), {
    timeout: options.timeout,
    maxRetries: options.maxRetries,
  });
}
