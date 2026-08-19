/* eslint-disable n8n-nodes-base/node-filename-against-convention -- the description lives
   beside the resources it is composed from, as n8n's own `actions/` nodes do; the class
   that uses it is Servicely.node.ts */
import { type INodeTypeDescription, NodeConnectionTypes } from 'n8n-workflow';

import * as attachment from './attachment';
import { requestOptionsProperty } from './common.descriptions';
import * as controller from './controller';
import * as globalSearch from './globalSearch';
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
  usableAsTool: true,
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
      // Alphabetical by name, as n8n's own resource selectors are
      options: [
        { name: 'Attachment', value: 'attachment' },
        { name: 'Controller', value: 'controller' },
        { name: 'Global Search', value: 'globalSearch' },
        { name: 'Object', value: 'object' },
        { name: 'Queue', value: 'queue' },
      ],
      default: 'object',
    },
    ...object.description,
    ...attachment.description,
    ...globalSearch.description,
    ...queue.description,
    ...controller.description,
    requestOptionsProperty,
  ],
};
