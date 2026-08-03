import type { INodeProperties } from 'n8n-workflow';

import * as call from './call.operation';

export { call };

/**
 * Properties for the Controller resource: invoke a Servicely controller endpoint
 * directly (`POST {instanceUrl}/controller/{ControllerName}`) with a raw JSON
 * body — the escape hatch for instance-specific controllers that the typed
 * Object / Attachment / Queue resources do not cover.
 */
export const description: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: { resource: ['controller'] } },
    options: [
      {
        name: 'Call',
        value: 'call',
        action: 'Call a controller',
        description: 'Post a raw JSON body to a controller endpoint (POST)',
      },
    ],
    default: 'call',
  },
  ...call.description,
];
