import { createHmac } from 'crypto';

import { describe, expect, it } from 'vitest';

import { AuthProvider } from '../transport/AuthProvider';
import type { AuthConfig, RequestSigningDetails } from '../types';

const provider = new AuthProvider();

describe('AuthProvider.basic', () => {
  it('base64-encodes user:pass into a Basic header', () => {
    const auth: AuthConfig = { method: 'basic', username: 'alice', password: 'secret' };
    const headers = provider.buildHeaders(auth);
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('alice:secret').toString('base64')}`);
  });

  it('tolerates a missing password (empty string)', () => {
    const headers = provider.buildHeaders({ method: 'basic', username: 'alice' });
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('alice:').toString('base64')}`);
  });

  it('throws when username is absent', () => {
    expect(() => provider.buildHeaders({ method: 'basic' })).toThrow(/username/i);
  });
});

describe('AuthProvider.bearer', () => {
  it('sets a Bearer Authorization header', () => {
    const headers = provider.buildHeaders({ method: 'bearer', apiToken: 'abc.def' });
    expect(headers.Authorization).toBe('Bearer abc.def');
  });

  it('throws without a token', () => {
    expect(() => provider.buildHeaders({ method: 'bearer' })).toThrow(/token/i);
  });
});

describe('AuthProvider.hmac', () => {
  const auth: AuthConfig = { method: 'hmac', apiToken: 'tok', sharedSecret: 'shh' };
  const details: RequestSigningDetails = {
    method: 'POST',
    path: '/v1/Incident',
    contentType: 'application/json',
    body: '{"a":1}',
  };

  it('produces a verifiable HMAC signature and Date/Content-MD5 headers', () => {
    const headers = provider.buildHeaders(auth, details);
    expect(headers.Date).toBeTruthy();
    expect(headers['Content-MD5']).toBeTruthy();

    // Recompute the signature using the Date the provider stamped, and compare.
    const [, signature] = headers.Authorization.replace('HMAC ', '').split(':');
    const stringToSign = ['POST', headers['Content-MD5'], 'application/json', headers.Date, '/v1/Incident'].join('\n');
    const expected = createHmac('sha256', 'shh').update(stringToSign).digest('base64');
    expect(signature).toBe(expected);
    expect(headers.Authorization.startsWith('HMAC tok:')).toBe(true);
  });

  it('omits Content-MD5 when there is no body', () => {
    const headers = provider.buildHeaders(auth, { method: 'GET', path: '/v1/User' });
    expect(headers['Content-MD5']).toBeUndefined();
  });

  it('throws without a shared secret', () => {
    expect(() => provider.buildHeaders({ method: 'hmac', apiToken: 'tok' }, details)).toThrow(/shared secret/i);
  });

  it('throws when signing details are missing', () => {
    expect(() => provider.buildHeaders(auth)).toThrow(/signing details/i);
  });
});

describe('AuthProvider unknown method', () => {
  it('throws on an unsupported method', () => {
    expect(() => provider.buildHeaders({ method: 'oauth' as never })).toThrow(/unsupported/i);
  });
});
