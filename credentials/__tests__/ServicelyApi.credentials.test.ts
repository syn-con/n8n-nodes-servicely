import { createHash, createHmac } from 'crypto';
import type { ICredentialDataDecryptedObject, IHttpRequestOptions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { ServicelyApi } from '../ServicelyApi.credentials';

const credential = new ServicelyApi();

function request(overrides: Partial<IHttpRequestOptions> = {}): IHttpRequestOptions {
  return { method: 'GET', url: '/v1/Incident', ...overrides };
}

async function authenticate(
  credentials: ICredentialDataDecryptedObject,
  overrides: Partial<IHttpRequestOptions> = {},
): Promise<IHttpRequestOptions> {
  return credential.authenticate(credentials, request(overrides));
}

describe('instance URL', () => {
  it('becomes the request baseURL, trimmed of whitespace and trailing slashes', async () => {
    const result = await authenticate({
      instanceUrl: '  https://acme.servicely.ai//  ',
      authMethod: 'bearer',
      apiToken: 't',
    });

    expect(result.baseURL).toBe('https://acme.servicely.ai');
  });
});

describe('bearer', () => {
  it('sets an Authorization header and keeps existing headers', async () => {
    const result = await authenticate(
      { instanceUrl: 'https://x.servicely.ai', authMethod: 'bearer', apiToken: 'abc123' },
      { headers: { Accept: 'application/json' } },
    );

    expect(result.headers).toEqual({ Accept: 'application/json', Authorization: 'Bearer abc123' });
  });

  it('is the default when no method is stored', async () => {
    const result = await authenticate({ instanceUrl: 'https://x.servicely.ai', apiToken: 'abc123' });

    expect(result.headers?.Authorization).toBe('Bearer abc123');
  });

  it('rejects a missing token', async () => {
    await expect(authenticate({ instanceUrl: 'https://x.servicely.ai', authMethod: 'bearer' })).rejects.toThrow(
      /requires an API token/,
    );
  });
});

describe('basic', () => {
  it('base64-encodes username:password', async () => {
    const result = await authenticate({
      instanceUrl: 'https://x.servicely.ai',
      authMethod: 'basic',
      username: 'user',
      password: 'pass',
    });

    expect(result.headers?.Authorization).toBe(`Basic ${Buffer.from('user:pass').toString('base64')}`);
  });

  it('treats a missing password as empty', async () => {
    const result = await authenticate({
      instanceUrl: 'https://x.servicely.ai',
      authMethod: 'basic',
      username: 'user',
    });

    expect(result.headers?.Authorization).toBe(`Basic ${Buffer.from('user:').toString('base64')}`);
  });

  it('rejects a missing username', async () => {
    await expect(
      authenticate({ instanceUrl: 'https://x.servicely.ai', authMethod: 'basic', password: 'p' }),
    ).rejects.toThrow(/requires a username/);
  });
});

describe('hmac', () => {
  const hmacCredentials: ICredentialDataDecryptedObject = {
    instanceUrl: 'https://x.servicely.ai',
    authMethod: 'hmac',
    apiToken: 'token',
    sharedSecret: 'secret',
  };

  /** Recompute the expected signature for the documented string-to-sign. */
  function expectedSignature(method: string, contentMd5: string, date: string, path: string): string {
    const stringToSign = [method, contentMd5, 'application/json', date, path].join('\n');
    return createHmac('sha256', 'secret').update(stringToSign).digest('base64');
  }

  it('signs a bodyless GET with an empty Content-MD5 and no Content-MD5 header', async () => {
    const result = await authenticate(hmacCredentials);
    const date = result.headers?.Date as string;

    expect(date).toBeTruthy();
    expect(result.headers?.['Content-MD5']).toBeUndefined();
    expect(result.headers?.Authorization).toBe(
      `HMAC token:${expectedSignature('GET', '', date, '/v1/Incident')}`,
    );
  });

  it('digests the serialized body into Content-MD5 and the signature', async () => {
    const body = { ShortDescription: 'printer down' };
    const result = await authenticate(hmacCredentials, { method: 'POST', url: '/v1/Incident', body });

    const md5 = createHash('md5').update(JSON.stringify(body)).digest('base64');
    const date = result.headers?.Date as string;

    expect(result.headers?.['Content-MD5']).toBe(md5);
    expect(result.headers?.Authorization).toBe(
      `HMAC token:${expectedSignature('POST', md5, date, '/v1/Incident')}`,
    );
  });

  it('signs the path only, excluding the host and query string', async () => {
    const result = await authenticate(hmacCredentials, {
      url: 'https://x.servicely.ai/v1/Incident?page=2',
    });
    const date = result.headers?.Date as string;

    expect(result.headers?.Authorization).toBe(
      `HMAC token:${expectedSignature('GET', '', date, '/v1/Incident')}`,
    );
  });

  it('strips a bare query string from a relative path', async () => {
    const result = await authenticate(hmacCredentials, { url: '/v1/Incident?page=2' });
    const date = result.headers?.Date as string;

    expect(result.headers?.Authorization).toBe(
      `HMAC token:${expectedSignature('GET', '', date, '/v1/Incident')}`,
    );
  });

  it('signs a string body verbatim', async () => {
    const result = await authenticate(hmacCredentials, { method: 'POST', url: '/v1/Incident', body: 'raw' });

    expect(result.headers?.['Content-MD5']).toBe(createHash('md5').update('raw').digest('base64'));
  });

  it('rejects a missing token or shared secret', async () => {
    await expect(
      authenticate({ instanceUrl: 'https://x.servicely.ai', authMethod: 'hmac', apiToken: 'token' }),
    ).rejects.toThrow(/API token and a shared secret/);
    await expect(
      authenticate({ instanceUrl: 'https://x.servicely.ai', authMethod: 'hmac', sharedSecret: 'secret' }),
    ).rejects.toThrow(/API token and a shared secret/);
  });
});
