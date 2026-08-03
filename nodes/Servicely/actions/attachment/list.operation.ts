import {
  type IDataObject,
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeProperties,
  updateDisplayOptions,
} from 'n8n-workflow';

import { locator, parentRef, servicelyApiRequest, toRecordList } from '../../GenericFunctions';
import { parentRecordProperties, relatedFieldProperty } from '../common.descriptions';

const properties: INodeProperties[] = [
  ...parentRecordProperties,
  {
    ...relatedFieldProperty,
    default: '',
    description: 'Attachment field on the parent record. Leave blank to match any field.',
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['attachment'], operation: ['list'] } },
  properties,
);

export async function execute(this: IExecuteFunctions, index: number): Promise<INodeExecutionData[]> {
  const parent = parentRef(locator(this, 'parentTable', index), locator(this, 'parentRecordId', index));
  const relatedField = this.getNodeParameter('relatedField', index, '') as string;

  const criteria: IDataObject[] = [{ fieldName: 'ParentRecord', operator: '=', value: parent }];
  if (relatedField) {
    criteria.push({ fieldName: 'RelatedField', operator: '=', value: relatedField });
  }

  const records = toRecordList<IDataObject>(
    await servicelyApiRequest.call(this, 'GET', '/v1/Attachment', undefined, {
      query: JSON.stringify({ and: criteria }),
      fields: 'id,FileName,MimeType,RelatedField,ParentRecord',
    }),
  );

  return records.map((json) => ({ json, pairedItem: { item: index } }));
}
