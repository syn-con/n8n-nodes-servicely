import type { ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * Servicely API credential.
 *
 * One flat credential type with an `authMethod` selector (KISS) so the
 * instance URL is not duplicated across method-specific credential types.
 * Secrets are stored encrypted by n8n and never exposed in workflow data.
 *
 * The Authorization header itself is constructed by the transport layer
 * (AuthProvider / ApiClient, Phase 3) — including HMAC signing, which cannot
 * be expressed declaratively — so no `authenticate`/`test` block is defined here.
 *
 * Docs: https://docs-servicely.atlassian.net/wiki/spaces/SD/pages/2242478081
 */
export class ServicelyApi implements ICredentialType {
  name = 'servicelyApi';

  displayName = 'Servicely API';

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
}
