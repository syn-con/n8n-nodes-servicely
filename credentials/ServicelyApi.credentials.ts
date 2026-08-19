import { createHash, createHmac } from 'crypto';

import type {
  Icon,
  ICredentialDataDecryptedObject,
  ICredentialTestRequest,
  ICredentialType,
  IDataObject,
  IHttpRequestOptions,
  INodeProperties,
} from 'n8n-workflow';

/** Request path used in the HMAC string-to-sign: no host, no query string. */
function signingPath(url: string): string {
  if (/^https?:\/\//i.test(url)) {
    return new URL(url).pathname;
  }
  return url.split('?')[0];
}

/** The body as it goes on the wire, for the Content-MD5 digest ('' when there is none). */
function signingBody(body: IHttpRequestOptions['body']): string {
  if (body === undefined || body === null) {
    return '';
  }
  return typeof body === 'string' ? body : JSON.stringify(body);
}

/**
 * HMAC Body signing (AWS-style). String-to-sign:
 *   {Method}\n{Content-MD5}\n{Content-Type}\n{Date}\n{URL path}
 * Header: `HMAC {token}:{base64(HMAC-SHA256(stringToSign, sharedSecret))}`.
 */
function hmacHeaders(credentials: ICredentialDataDecryptedObject, request: IHttpRequestOptions): IDataObject {
  const { apiToken, sharedSecret } = credentials;
  if (!apiToken || !sharedSecret) {
    throw new Error('HMAC authentication requires both an API token and a shared secret.');
  }

  const date = new Date().toUTCString();
  const contentType = 'application/json';
  const body = signingBody(request.body);
  const contentMd5 = body === '' ? '' : createHash('md5').update(body).digest('base64');

  const stringToSign = [request.method ?? 'GET', contentMd5, contentType, date, signingPath(request.url)].join('\n');
  const signature = createHmac('sha256', String(sharedSecret)).update(stringToSign).digest('base64');

  const headers: IDataObject = { Authorization: `HMAC ${String(apiToken)}:${signature}`, Date: date };
  if (contentMd5 !== '') {
    headers['Content-MD5'] = contentMd5;
  }
  return headers;
}

/** Basic auth header from the username/password fields. */
function basicHeaders(credentials: ICredentialDataDecryptedObject): IDataObject {
  const { username, password } = credentials;
  if (!username) {
    throw new Error('Basic authentication requires a username.');
  }
  const token = Buffer.from(`${String(username)}:${String(password ?? '')}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

/** Bearer auth header from the API token field. */
function bearerHeaders(credentials: ICredentialDataDecryptedObject): IDataObject {
  const { apiToken } = credentials;
  if (!apiToken) {
    throw new Error('Bearer authentication requires an API token.');
  }
  return { Authorization: `Bearer ${String(apiToken)}` };
}

/**
 * Servicely API credential.
 *
 * One flat credential type with an `authMethod` selector so the instance URL is
 * not duplicated across method-specific credential types. Secrets are stored
 * encrypted by n8n and never exposed in workflow data.
 *
 * Docs: https://docs-servicely.atlassian.net/wiki/spaces/SD/pages/2242478081
 */
export class ServicelyApi implements ICredentialType {
  name = 'servicelyApi';

  displayName = 'Servicely API';

  icon: Icon = { light: 'file:../icons/servicely.svg', dark: 'file:../icons/servicely.dark.svg' };

  documentationUrl = 'https://docs-servicely.atlassian.net/wiki/spaces/SD/pages/2242478081';

  properties: INodeProperties[] = [
    {
      displayName: 'Instance URL',
      name: 'instanceUrl',
      type: 'string',
      default: '',
      placeholder: 'https://your-instance.servicely.ai',
      description: 'Base URL of your Servicely instance, without a trailing slash or /v1',
      required: true,
    },
    {
      displayName: 'Authentication Method',
      name: 'authMethod',
      type: 'options',
      options: [
        { name: 'Bearer Token', value: 'bearer' },
        { name: 'Basic Auth', value: 'basic' },
        { name: 'HMAC', value: 'hmac' },
      ],
      default: 'bearer',
      description: 'How requests authenticate to Servicely. Configure tokens under Administration → Integration → System API Tokens.',
    },
    {
      displayName: 'Username',
      name: 'username',
      type: 'string',
      default: '',
      displayOptions: { show: { authMethod: ['basic'] } },
      description: 'Username for Basic authentication',
    },
    {
      displayName: 'Password',
      name: 'password',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      displayOptions: { show: { authMethod: ['basic'] } },
      description: 'Password for Basic authentication',
    },
    {
      displayName: 'API Token',
      name: 'apiToken',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      displayOptions: { show: { authMethod: ['bearer', 'hmac'] } },
      description: 'System API Token (full token: prefix + secret) used as the Bearer token or HMAC identity',
    },
    {
      displayName: 'Shared Secret',
      name: 'sharedSecret',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      displayOptions: { show: { authMethod: ['hmac'] } },
      description: 'Shared secret used to sign requests with HMAC-SHA256',
    },
  ];

  /**
   * What the credential's **Test** button sends: one row of the table registry.
   * It is the smallest authenticated read every instance answers, and the same
   * table the Table pickers list, so a credential that passes here is one the
   * nodes can work with.
   *
   * {@link authenticate} runs first, which is what makes one request enough for
   * all three methods — the HMAC signature is computed over this request like any
   * other, and `baseURL` comes from the Instance URL, so only the path is named.
   */
  test: ICredentialTestRequest = {
    request: {
      method: 'GET',
      url: '/v1/TableDefinition',
      qs: { page: 1, page_size: 1 },
    },
  };

  /**
   * Applied by n8n to every request the nodes make through
   * `helpers.httpRequestWithAuthentication`, so no node code reads credentials.
   * It also resolves the instance URL into `baseURL`, letting the nodes pass
   * plain paths like `/v1/Incident`.
   *
   * This is the function form (rather than a declarative `generic` block)
   * because HMAC signs the method, path, and body of each individual request —
   * and because it is re-run per attempt, a retry gets a fresh Date/Content-MD5.
   */
  async authenticate(
    credentials: ICredentialDataDecryptedObject,
    requestOptions: IHttpRequestOptions,
  ): Promise<IHttpRequestOptions> {
    requestOptions.baseURL = String(credentials.instanceUrl ?? '')
      .trim()
      .replace(/\/+$/, '');

    let auth: IDataObject;
    switch (credentials.authMethod) {
      case 'basic':
        auth = basicHeaders(credentials);
        break;
      case 'hmac':
        auth = hmacHeaders(credentials, requestOptions);
        break;
      default:
        auth = bearerHeaders(credentials);
    }

    requestOptions.headers = { ...requestOptions.headers, ...auth };
    return requestOptions;
  }
}
