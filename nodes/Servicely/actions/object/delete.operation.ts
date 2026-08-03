import {
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeProperties,
  updateDisplayOptions,
} from 'n8n-workflow';

import { locator, servicelyApiRequest } from '../../GenericFunctions';
import { recordResourceLocator } from '../common.descriptions';

const properties: INodeProperties[] = [
  recordResourceLocator({
    name: 'recordId',
    displayName: 'Record',
    description: 'The record to delete',
    searchListMethod: 'searchObjectRecords',
  }),
];

export const description = updateDisplayOptions(
  { show: { resource: ['object'], operation: ['delete'] } },
  properties,
);

export async function execute(this: IExecuteFunctions, index: number): Promise<INodeExecutionData[]> {
  const table = locator(this, 'tableName', index);
  const id = locator(this, 'recordId', index);
  await servicelyApiRequest.call(this, 'DELETE', `/v1/${table}/${id}`);

  return [{ json: { success: true, table, id }, pairedItem: { item: index } }];
}
