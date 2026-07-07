import { createHash, createHmac } from 'crypto';

import type { AuthConfig, RequestSigningDetails } from '../types';

/**
 * Builds the Authorization (and related) headers for an outbound request.
 *
 * Strategy-style: one private method per auth method, so adding a method is an
 * extension rather than a modification of existing branches (Open/Closed).
 * Pure with respect to credentials — no I/O.
 */
export class AuthProvider {
  buildHeaders(auth: AuthConfig, details?: RequestSigningDetails): Record<string, string> {
    switch (auth.method) {
      case 'basic':
        return this.basic(auth);
      case 'bearer':
        return this.bearer(auth);
      case 'hmac':
        return this.hmac(auth, details);
      default:
        throw new Error(`Unsupported authentication method: ${String((auth as AuthConfig).method)}`);
    }
  }

  private basic(auth: AuthConfig): Record<string, string> {
    if (!auth.username) {
      throw new Error('Basic authentication requires a username.');
    }
    const token = Buffer.from(`${auth.username}:${auth.password ?? ''}`).toString('base64');
    return { Authorization: `Basic ${token}` };
  }

  private bearer(auth: AuthConfig): Record<string, string> {
    if (!auth.apiToken) {
      throw new Error('Bearer authentication requires an API token.');
    }
    return { Authorization: `Bearer ${auth.apiToken}` };
  }

  /**
   * HMAC Body signing (AWS-style). String-to-sign:
   *   {Method}\n{Content-MD5}\n{Content-Type}\n{Date}\n{URL path}
   * Header: `HMAC {token}:{base64(HMAC-SHA256(stringToSign, sharedSecret))}`.
   */
  private hmac(auth: AuthConfig, details?: RequestSigningDetails): Record<string, string> {
    if (!auth.apiToken || !auth.sharedSecret) {
      throw new Error('HMAC authentication requires both an API token and a shared secret.');
    }
    if (!details) {
      throw new Error('HMAC authentication requires request signing details.');
    }

    const date = new Date().toUTCString();
    const contentType = details.contentType ?? 'application/json';
    const hasBody = typeof details.body === 'string' && details.body.length > 0;
    const contentMd5 = hasBody ? createHash('md5').update(details.body as string).digest('base64') : '';

    const stringToSign = [details.method, contentMd5, contentType, date, details.path].join('\n');
    const signature = createHmac('sha256', auth.sharedSecret).update(stringToSign).digest('base64');

    const headers: Record<string, string> = {
      Authorization: `HMAC ${auth.apiToken}:${signature}`,
      Date: date,
    };
    if (hasBody) {
      headers['Content-MD5'] = contentMd5;
    }
    return headers;
  }
}
