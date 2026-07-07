import { describe, expect, it, vi } from 'vitest';

import { ApiClient } from '../transport/ApiClient';
import { buildClient, makeHttpFn } from '../transport/clientFactory';

/** Build a fake exec/load-options context with spyable credentials + httpRequest. */
function fakeCtx(overrides: Record<string, unknown> = {}) {
  return {
    getCredentials: vi.fn(async () => ({
      instanceUrl: 'https://acme.servicely.ai/',
      authMethod: 'bearer',
      apiToken: 'tok',
    })),
    helpers: { httpRequest: vi.fn(async () => ({ statusCode: 200, headers: {}, body: { data: [] } })) },
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('clientFactory — makeHttpFn', () => {
  it('maps a spec to the n8n helper and normalizes the full response', async () => {
    const httpRequest = vi.fn(async () => ({ statusCode: 201, headers: { 'x-page': '1' }, body: { ok: true } }));
    const fn = makeHttpFn(fakeCtx({ helpers: { httpRequest } }));
    const res = await fn({
      method: 'POST',
      url: 'https://acme/x',
      headers: { A: 'b' },
      qs: { p: 1 },
      body: { y: 2 },
      timeout: 5,
    });
    expect(httpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: 'https://acme/x',
        json: true,
        returnFullResponse: true,
        ignoreHttpStatusErrors: true,
        timeout: 5,
      }),
    );
    expect(res).toEqual({ statusCode: 201, headers: { 'x-page': '1' }, body: { ok: true } });
  });
});

describe('clientFactory — buildClient', () => {
  it('reads credentials and builds an ApiClient targeting the instance URL', async () => {
    const httpRequest = vi.fn(async () => ({ statusCode: 200, headers: {}, body: { data: [] } }));
    const client = await buildClient(fakeCtx({ helpers: { httpRequest } }), { timeout: 1234, maxRetries: 0 });
    expect(client).toBeInstanceOf(ApiClient);

    await client.get('Incident');
    expect(httpRequest).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://acme.servicely.ai/v1/Incident', timeout: 1234 }),
    );
  });

  it('tolerates a missing instance URL', async () => {
    const ctx = fakeCtx({ getCredentials: vi.fn(async () => ({ authMethod: 'bearer', apiToken: 't' })) });
    const client = await buildClient(ctx);
    expect(client).toBeInstanceOf(ApiClient);
  });
});
