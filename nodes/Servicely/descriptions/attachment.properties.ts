import type { INodeProperties } from 'n8n-workflow';

import { recordResourceLocator, tableResourceLocator } from './resourceLocators';

const showForAttachment = { resource: ['attachment'] };

/** Properties for the Attachment resource (download / upload / list). */
export const attachmentProperties: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: showForAttachment },
    options: [
      { name: 'Download', value: 'download', action: 'Download an attachment', description: 'Fetch an attachment as binary data' },
      { name: 'List', value: 'list', action: 'List attachments', description: 'List attachments on a parent record' },
      { name: 'Upload', value: 'upload', action: 'Upload an attachment', description: 'Attach a binary file to a record' },
    ],
    default: 'download',
  },
  recordResourceLocator({
    name: 'attachmentId',
    displayName: 'Attachment',
    description: 'The attachment record to download',
    searchListMethod: 'searchAttachments',
    displayOptions: { show: { ...showForAttachment, operation: ['download'] } },
  }),
  tableResourceLocator({
    name: 'parentTable',
    displayName: 'Parent Table',
    description: 'Table of the record the attachment belongs to',
    displayOptions: { show: { ...showForAttachment, operation: ['upload', 'list'] } },
    default: 'Incident',
  }),
  recordResourceLocator({
    name: 'parentRecordId',
    displayName: 'Parent Record',
    description: 'The parent record the attachment belongs to',
    searchListMethod: 'searchParentRecords',
    displayOptions: { show: { ...showForAttachment, operation: ['upload', 'list'] } },
  }),
  {
    displayName: 'Related Field',
    name: 'relatedField',
    type: 'string',
    default: 'Attachments',
    description: 'Attachment field on the parent record (default "Attachments"). Leave blank when listing to match any field.',
    displayOptions: { show: { ...showForAttachment, operation: ['upload', 'list'] } },
  },
  {
    displayName: 'Input Binary Field',
    name: 'binaryPropertyName',
    type: 'string',
    default: 'data',
    required: true,
    hint: 'The name of the input binary field containing the file to upload',
    displayOptions: { show: { ...showForAttachment, operation: ['upload'] } },
  },
  {
    displayName: 'Put Output File in Field',
    name: 'binaryPropertyName',
    type: 'string',
    default: 'data',
    required: true,
    hint: 'The name of the output binary field to write the downloaded file to',
    displayOptions: { show: { ...showForAttachment, operation: ['download'] } },
  },
  {
    displayName: 'File Name',
    name: 'fileName',
    type: 'string',
    default: '',
    placeholder: 'screenshot.png',
    description: 'Override the file name. Defaults to the binary field file name.',
    displayOptions: { show: { ...showForAttachment, operation: ['upload'] } },
  },
  {
    displayName: 'MIME Type',
    name: 'mimeType',
    type: 'string',
    default: '',
    placeholder: 'image/png',
    description: 'Override the MIME type. Defaults to the binary field MIME type.',
    displayOptions: { show: { ...showForAttachment, operation: ['upload'] } },
  },
];
