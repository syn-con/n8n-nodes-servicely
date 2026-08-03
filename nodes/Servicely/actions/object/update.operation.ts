import {
  type IDataObject,
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeProperties,
  updateDisplayOptions,
} from 'n8n-workflow';

import { fieldsToSet, locator, servicelyApiRequest } from '../../GenericFunctions';
import { fieldsToSetProperty, recordResourceLocator } from '../common.descriptions';

const properties: INodeProperties[] = [
  recordResourceLocator({
    name: 'recordId',
    displayName: 'Record',
    description: 'The record to update',
    searchListMethod: 'searchObjectRecords',
  }),
  fieldsToSetProperty,
];

export const description = updateDisplayOptions(
  { show: { resource: ['object'], operation: ['update'] } },
  properties,
);

export async function execute(this: IExecuteFunctions, index: number): Promise<INodeExecutionData[]> {
  const table = locator(this, 'tableName', index);
  const id = locator(this, 'recordId', index);
  const record = await servicelyApiRequest.call(this, 'PATCH', `/v1/${table}/${id}`, fieldsToSet(this, index));

  return [{ json: record as IDataObject, pairedItem: { item: index } }];
}
