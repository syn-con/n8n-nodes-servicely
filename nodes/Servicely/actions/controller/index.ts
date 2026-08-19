import type { INodeProperties } from 'n8n-workflow';

import * as invoke from './invoke.operation';

/**
 * `invoke` is the operation; `call` is what it was called before, and is still
 * accepted. The router resolves an operation by looking its value up on this
 * module, so exporting the same module under both names is the whole of what a
 * legacy workflow needs — nothing downstream has to know about the rename.
 *
 * n8n saves only the parameters that differ from their default, so a workflow
 * built in the UI never held `call` in the first place: the selector has one
 * option, which is its default. One created through the API or imported as JSON
 * does spell it out, which is who the alias is for.
 */
export { invoke, invoke as call };

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
        name: 'Invoke',
        value: 'invoke',
        action: 'Invoke a controller',
        description: 'Invoke a controller on the instance with a JSON body and return its answer',
      },
    ],
    default: 'invoke',
  },
  ...invoke.description,
];
