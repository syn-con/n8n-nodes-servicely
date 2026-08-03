import {
  type IDataObject,
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeProperties,
  updateDisplayOptions,
} from 'n8n-workflow';

import { locator, parentRef, servicelyApiRequest } from '../../GenericFunctions';
import { parentRecordProperties, relatedFieldProperty } from '../common.descriptions';

const properties: INodeProperties[] = [
  ...parentRecordProperties,
  relatedFieldProperty,
  {
    displayName: 'Input Binary Field',
    name: 'binaryPropertyName',
    type: 'string',
    default: 'data',
    required: true,
    hint: 'The name of the input binary field containing the file to upload',
  },
  {
    displayName: 'File Name',
    name: 'fileName',
    type: 'string',
    default: '',
    placeholder: 'screenshot.png',
    description: 'Override the file name. Defaults to the binary field file name.',
  },
  {
    displayName: 'MIME Type',
    name: 'mimeType',
    type: 'string',
    default: '',
    placeholder: 'image/png',
    description: 'Override the MIME type. Defaults to the binary field MIME type.',
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['attachment'], operation: ['upload'] } },
  properties,
);

export async function execute(this: IExecuteFunctions, index: number): Promise<INodeExecutionData[]> {
  const binaryProperty = this.getNodeParameter('binaryPropertyName', index, 'data') as string;
  const binaryMeta = this.helpers.assertBinaryData(index, binaryProperty);
  const buffer = await this.helpers.getBinaryDataBuffer(index, binaryProperty);

  // NOTE (GATE 5.0): direct POST /v1/Attachment with a base64 Data blob is not
  // documented for inbound REST. If a live instance rejects this, route uploads
  // through a custom controller. Field names + ParentRecord format are confirmed.
  const record = await servicelyApiRequest.call(this, 'POST', '/v1/Attachment', {
    MimeType:
      (this.getNodeParameter('mimeType', index, '') as string) || binaryMeta.mimeType || 'application/octet-stream',
    FileName: (this.getNodeParameter('fileName', index, '') as string) || binaryMeta.fileName || 'file',
    Data: buffer.toString('base64'),
    RelatedField: (this.getNodeParameter('relatedField', index, 'Attachments') as string) || 'Attachments',
    ParentRecord: parentRef(locator(this, 'parentTable', index), locator(this, 'parentRecordId', index)),
  });

  return [{ json: record as IDataObject, pairedItem: { item: index } }];
}
