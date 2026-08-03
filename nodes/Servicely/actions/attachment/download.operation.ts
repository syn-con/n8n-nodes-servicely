import {
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeProperties,
  updateDisplayOptions,
} from 'n8n-workflow';

import { locator, servicelyApiRequest } from '../../GenericFunctions';
import { recordResourceLocator } from '../common.descriptions';
import type { AttachmentRecord } from '../../types';

const properties: INodeProperties[] = [
  recordResourceLocator({
    name: 'attachmentId',
    displayName: 'Attachment',
    description: 'The attachment record to download',
    searchListMethod: 'searchAttachments',
  }),
  {
    displayName: 'Put Output File in Field',
    name: 'binaryPropertyName',
    type: 'string',
    default: 'data',
    required: true,
    hint: 'The name of the output binary field to write the downloaded file to',
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['attachment'], operation: ['download'] } },
  properties,
);

export async function execute(this: IExecuteFunctions, index: number): Promise<INodeExecutionData[]> {
  const binaryProperty = this.getNodeParameter('binaryPropertyName', index, 'data') as string;
  const record = (await servicelyApiRequest.call(
    this,
    'GET',
    `/v1/Attachment/${locator(this, 'attachmentId', index)}`,
  )) as AttachmentRecord;

  const buffer = Buffer.from((record.Data as string) ?? '', 'base64');

  return [
    {
      json: {
        id: record.id,
        fileName: record.FileName,
        mimeType: record.MimeType,
        relatedField: record.RelatedField,
        parentRecord: record.ParentRecord,
      },
      binary: {
        [binaryProperty]: await this.helpers.prepareBinaryData(buffer, record.FileName, record.MimeType),
      },
      pairedItem: { item: index },
    },
  ];
}
