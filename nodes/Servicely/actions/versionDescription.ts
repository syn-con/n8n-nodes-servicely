import { type INodeTypeDescription, NodeConnectionTypes } from 'n8n-workflow';

import * as attachment from './attachment';
import { requestOptionsProperty } from './common.descriptions';
import * as controller from './controller';
import * as object from './object';
import * as queue from './queue';

/**
 * The node's declarative surface. Each resource folder contributes its own
 * operation selector and fields, so adding an operation means adding a file —
 * nothing here changes except the resource's own `index.ts`.
 */
export const versionDescription: INodeTypeDescription = {
  displayName: 'Servicely',
  name: 'servicely',
  icon: { light: 'file:../../icons/servicely.svg', dark: 'file:../../icons/servicely.dark.svg' },
  group: ['transform'],
  version: 1,
  subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
  description: 'Read and write records and attachments in Servicely via the JSON REST API',
  documentationUrl: 'https://docs-servicely.atlassian.net/wiki/spaces/SD/pages/2077523978',
  defaults: { name: 'Servicely' },
  inputs: [NodeConnectionTypes.Main],
  outputs: [NodeConnectionTypes.Main],
  credentials: [{ name: 'servicelyApi', required: true }],
  properties: [
    {
      displayName: 'Resource',
      name: 'resource',
      type: 'options',
      noDataExpression: true,
      options: [
        { name: 'Object', value: 'object' },
        { name: 'Attachment', value: 'attachment' },
        { name: 'Queue', value: 'queue' },
        { name: 'Controller', value: 'controller' },
      ],
      default: 'object',
    },
    ...object.description,
    ...attachment.description,
    ...queue.description,
    ...controller.description,
    requestOptionsProperty,
  ],
};
