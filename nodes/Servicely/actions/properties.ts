import type { INodeProperties } from 'n8n-workflow';

import * as aiAgentTool from './aiAgentTool';
import * as attachment from './attachment';
import { requestOptionsProperty } from './common.descriptions';
import * as controller from './controller';
import * as globalSearch from './globalSearch';
import * as object from './object';
import * as queue from './queue';

/**
 * The node's fields. Each resource folder contributes its own operation selector
 * and the fields that operation needs, so adding an operation means adding a file —
 * nothing here changes except the resource's own `index.ts`.
 *
 * Only the fields: the node itself — its name, icon, version, credentials — is
 * declared in `Servicely.node.ts`, which is where n8n's own checks look for it and
 * where a reader looks first.
 */
export const properties: INodeProperties[] = [
  {
    displayName: 'Resource',
    name: 'resource',
    type: 'options',
    noDataExpression: true,
    // Alphabetical by name, as n8n's own resource selectors are
    options: [
      { name: 'AI Agent Tool', value: 'aiAgentTool' },
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
  ...aiAgentTool.description,
  requestOptionsProperty,
];
