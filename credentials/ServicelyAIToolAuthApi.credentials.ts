// This credential describes what an incoming tool call must present, so unlike ServicelyApi it
// has no `test` block — there is no service to authenticate against.
import type { Icon, ICredentialType, INodeProperties } from 'n8n-workflow';

export class ServicelyAIToolAuthApi implements ICredentialType {
	name = 'servicelyAiToolAuthApi';

	displayName = 'Servicely AI Tool Auth API';

	icon: Icon = { light: 'file:../icons/servicely.svg', dark: 'file:../icons/servicely.dark.svg' };

	documentationUrl = 'https://docs-servicely.atlassian.net/wiki/spaces/SD/pages/2242478081';

	properties: INodeProperties[] = [
		{
			displayName: 'Type',
			name: 'type',
			type: 'options',
			options: [
				{
					name: 'Basic Auth',
					value: 'basicAuth',
					description: 'The request must send an "Authorization: Basic" header',
				},
				{
					name: 'Header Auth',
					value: 'headerAuth',
					description: 'The request must send a header with a fixed value',
				},
				{
					name: 'JWT Auth',
					value: 'jwtAuth',
					description: 'The request must send a signed JWT as a bearer token',
				},
			],
			default: 'basicAuth',
			description: 'The authentication method a call to the Servicely AI Tool must use',
		},
		{
			displayName: 'User',
			name: 'user',
			type: 'string',
			default: '',
			description: 'The user the request must authenticate with',
			displayOptions: { show: { type: ['basicAuth'] } },
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'The password the request must authenticate with',
			displayOptions: { show: { type: ['basicAuth'] } },
		},
		{
			displayName: 'Header Name',
			name: 'headerName',
			type: 'string',
			default: '',
			placeholder: 'e.g. X-API-KEY',
			description: 'Name of the header the request must send',
			displayOptions: { show: { type: ['headerAuth'] } },
		},
		{
			displayName: 'Header Value',
			name: 'headerValue',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'The value that header must have',
			displayOptions: { show: { type: ['headerAuth'] } },
		},
		{
			displayName: 'Key Type',
			name: 'keyType',
			type: 'options',
			options: [
				{
					name: 'Passphrase',
					value: 'passphrase',
					description: 'A shared secret, for the HS256, HS384 and HS512 algorithms',
				},
				{
					name: 'PEM Key',
					value: 'pemKey',
					description: 'A public key, for the RS, PS and ES algorithms',
				},
			],
			default: 'passphrase',
			description: 'How the token signature is verified',
			displayOptions: { show: { type: ['jwtAuth'] } },
		},
		{
			displayName: 'Secret',
			name: 'secret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'The shared secret the token is signed with',
			displayOptions: { show: { type: ['jwtAuth'], keyType: ['passphrase'] } },
		},
		{
			displayName: 'Public Key',
			name: 'publicKey',
			type: 'string',
			typeOptions: { password: true, rows: 4 },
			default: '',
			placeholder: '-----BEGIN PUBLIC KEY-----',
			description: 'The PEM public key matching the key the token was signed with',
			displayOptions: { show: { type: ['jwtAuth'], keyType: ['pemKey'] } },
		},
		{
			displayName: 'Algorithm',
			name: 'algorithm',
			type: 'options',
			options: [
				{ name: 'ES256', value: 'ES256' },
				{ name: 'ES384', value: 'ES384' },
				{ name: 'ES512', value: 'ES512' },
				{ name: 'HS256', value: 'HS256' },
				{ name: 'HS384', value: 'HS384' },
				{ name: 'HS512', value: 'HS512' },
				{ name: 'PS256', value: 'PS256' },
				{ name: 'PS384', value: 'PS384' },
				{ name: 'PS512', value: 'PS512' },
				{ name: 'RS256', value: 'RS256' },
				{ name: 'RS384', value: 'RS384' },
				{ name: 'RS512', value: 'RS512' },
			],
			default: 'HS256',
			description:
				'The algorithm the token must be signed with. Tokens signed with any other algorithm are rejected.',
			displayOptions: { show: { type: ['jwtAuth'] } },
		},
	];
}
