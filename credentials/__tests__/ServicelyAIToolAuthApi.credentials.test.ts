import type { INodeProperties } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { ServicelyAIToolAuthApi } from '../ServicelyAIToolAuthApi.credentials';

const credential = new ServicelyAIToolAuthApi();

const property = (name: string): INodeProperties => {
  const found = credential.properties.find((entry) => entry.name === name);
  if (found === undefined) {
    throw new Error(`the credential has no "${name}" property`);
  }
  return found;
};

/** The `type` values every field is gated on, as `authenticate` switches on them. */
const shownFor = (name: string) => property(name).displayOptions?.show?.type;

describe('shape', () => {
  it('is registered under the name the AI Tool node asks for', () => {
    expect(credential.name).toBe('servicelyAiToolAuthApi');
    expect(credential.displayName).toBe('Servicely AI Agent Tool Auth API');
  });

  it('offers the three authentication methods the node implements', () => {
    expect(property('type').options?.map((option) => (option as { value: string }).value)).toEqual([
      'basicAuth',
      'headerAuth',
      'jwtAuth',
    ]);
    expect(property('type').default).toBe('basicAuth');
  });

  it('shows each field only for the method it belongs to', () => {
    expect(shownFor('user')).toEqual(['basicAuth']);
    expect(shownFor('password')).toEqual(['basicAuth']);
    expect(shownFor('headerName')).toEqual(['headerAuth']);
    expect(shownFor('headerValue')).toEqual(['headerAuth']);
    expect(shownFor('keyType')).toEqual(['jwtAuth']);
    expect(shownFor('algorithm')).toEqual(['jwtAuth']);
  });

  it('asks for a secret for a passphrase and a public key for a PEM key', () => {
    expect(property('secret').displayOptions?.show).toEqual({
      type: ['jwtAuth'],
      keyType: ['passphrase'],
    });
    expect(property('publicKey').displayOptions?.show).toEqual({
      type: ['jwtAuth'],
      keyType: ['pemKey'],
    });
  });

  it('masks every secret field', () => {
    for (const name of ['password', 'headerValue', 'secret', 'publicKey']) {
      expect(property(name).typeOptions?.password).toBe(true);
    }
  });

  it('defaults to HS256 and covers the algorithms the verifier supports', () => {
    const algorithms = property('algorithm').options?.map(
      (option) => (option as { value: string }).value,
    );

    expect(property('algorithm').default).toBe('HS256');
    expect(algorithms).toHaveLength(12);
    expect(algorithms).toContain('ES512');
    expect(algorithms).toContain('RS256');
  });
});
