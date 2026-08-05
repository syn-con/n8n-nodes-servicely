import {
  type IDataObject,
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeProperties,
  updateDisplayOptions,
} from 'n8n-workflow';

import { fieldsToSet, locatorLabel, servicelyApiRequest, stringParam } from '../../GenericFunctions';
import { fieldsToSetProperty, idProperty } from '../common.descriptions';

const properties: INodeProperties[] = [
  idProperty({ name: 'recordId', displayName: 'Record ID', description: 'ID of the record to update' }),
  fieldsToSetProperty,
];

export const description = updateDisplayOptions(
  { show: { resource: ['object'], operation: ['update'] } },
  properties,
);

export async function execute(this: IExecuteFunctions, index: number): Promise<INodeExecutionData[]> {
  const table = locatorLabel(this, 'tableName', index);
  const id = stringParam(this, 'recordId', index);
  const record = await servicelyApiRequest.call(this, 'PATCH', `/v1/${table}/${id}`, fieldsToSet(this, index));

  return [{ json: record as IDataObject, pairedItem: { item: index } }];
}
