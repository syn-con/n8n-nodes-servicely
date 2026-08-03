import type { INodeProperties } from 'n8n-workflow';

import * as download from './download.operation';
import * as list from './list.operation';
import * as upload from './upload.operation';

export { download, list, upload };

/** Properties for the Attachment resource (download / list / upload). */
export const description: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: { resource: ['attachment'] } },
    options: [
      {
        name: 'Download',
        value: 'download',
        action: 'Download an attachment',
        description: 'Fetch an attachment as binary data',
      },
      { name: 'List', value: 'list', action: 'List attachments', description: 'List attachments on a parent record' },
      { name: 'Upload', value: 'upload', action: 'Upload an attachment', description: 'Attach a binary file to a record' },
    ],
    default: 'download',
  },
  ...download.description,
  ...list.description,
  ...upload.description,
];
