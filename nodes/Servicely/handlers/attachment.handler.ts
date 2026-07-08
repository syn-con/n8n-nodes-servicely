import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import type { AttachmentRecord, IServicelyClient, ServicelyQuery } from '../types';

/** Options bag telling n8n to return a resourceLocator's underlying value. */
const EXTRACT_VALUE = { extractValue: true } as const;

/** Build the `{recordId}:{tableName}` reference Servicely uses for ParentRecord. */
function parentRef(table: string, recordId: string): string {
  return `${recordId}:${table}`;
}

async function list(ctx: IExecuteFunctions, client: IServicelyClient, i: number): Promise<INodeExecutionData[]> {
  const table = ctx.getNodeParameter('parentTable', i, '', EXTRACT_VALUE) as string;
  const recordId = ctx.getNodeParameter('parentRecordId', i, '', EXTRACT_VALUE) as string;
  const relatedField = ctx.getNodeParameter('relatedField', i, '') as string;

  const criteria: ServicelyQuery['and'] = [
    { fieldName: 'ParentRecord', operator: '=', value: parentRef(table, recordId) },
  ];
  if (relatedField) {
    criteria!.push({ fieldName: 'RelatedField', operator: '=', value: relatedField });
  }

  const result = await client.get<AttachmentRecord>('Attachment', {
    query: { and: criteria },
    fields: 'id,FileName,MimeType,RelatedField,ParentRecord',
  });
  return result.data.map((record) => ({ json: record as IDataObject }));
}

async function download(ctx: IExecuteFunctions, client: IServicelyClient, i: number): Promise<INodeExecutionData[]> {
  const attachmentId = ctx.getNodeParameter('attachmentId', i, '', EXTRACT_VALUE) as string;
  const binaryProperty = ctx.getNodeParameter('binaryPropertyName', i, 'data') as string;

  const record = await client.getOne<AttachmentRecord>('Attachment', attachmentId);
  const base64 = (record.Data as string) ?? '';
  const buffer = Buffer.from(base64, 'base64');
  const binary = await ctx.helpers.prepareBinaryData(buffer, record.FileName, record.MimeType);

  return [
    {
      json: {
        id: record.id,
        fileName: record.FileName,
        mimeType: record.MimeType,
        relatedField: record.RelatedField,
        parentRecord: record.ParentRecord,
      },
      binary: { [binaryProperty]: binary },
    },
  ];
}

async function upload(ctx: IExecuteFunctions, client: IServicelyClient, i: number): Promise<INodeExecutionData[]> {
  const table = ctx.getNodeParameter('parentTable', i, '', EXTRACT_VALUE) as string;
  const recordId = ctx.getNodeParameter('parentRecordId', i, '', EXTRACT_VALUE) as string;
  const relatedField = (ctx.getNodeParameter('relatedField', i, 'Attachments') as string) || 'Attachments';
  const binaryProperty = ctx.getNodeParameter('binaryPropertyName', i, 'data') as string;

  const binaryMeta = ctx.helpers.assertBinaryData(i, binaryProperty);
  const buffer = await ctx.helpers.getBinaryDataBuffer(i, binaryProperty);

  const fileName = (ctx.getNodeParameter('fileName', i, '') as string) || binaryMeta.fileName || 'file';
  const mimeType =
    (ctx.getNodeParameter('mimeType', i, '') as string) || binaryMeta.mimeType || 'application/octet-stream';

  // NOTE (GATE 5.0): direct POST /v1/Attachment with a base64 Data blob is not
  // documented for inbound REST. If a live instance rejects this, route uploads
  // through a custom controller. Field names + ParentRecord format are confirmed.
  const payload: IDataObject = {
    MimeType: mimeType,
    FileName: fileName,
    Data: buffer.toString('base64'),
    RelatedField: relatedField,
    ParentRecord: parentRef(table, recordId),
  };

  const created = await client.create<AttachmentRecord>('Attachment', payload);
  return [{ json: created as IDataObject }];
}

/** Route an Attachment operation to its handler. */
export async function executeAttachmentOperation(
  ctx: IExecuteFunctions,
  client: IServicelyClient,
  operation: string,
  i: number,
): Promise<INodeExecutionData[]> {
  switch (operation) {
    case 'list':
      return list(ctx, client, i);
    case 'download':
      return download(ctx, client, i);
    case 'upload':
      return upload(ctx, client, i);
    default:
      throw new Error(`Unsupported Attachment operation: ${operation}`);
  }
}
