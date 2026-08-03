import {
  type IDataObject,
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeProperties,
  updateDisplayOptions,
} from 'n8n-workflow';

import { fieldsToSet, locator, servicelyApiRequest } from '../../GenericFunctions';
import { fieldsToSetProperty } from '../common.descriptions';

const properties: INodeProperties[] = [fieldsToSetProperty];

export const description = updateDisplayOptions(
  { show: { resource: ['object'], operation: ['create'] } },
  properties,
);

export async function execute(this: IExecuteFunctions, index: number): Promise<INodeExecutionData[]> {
  const table = locator(this, 'tableName', index);
  const record = await servicelyApiRequest.call(this, 'POST', `/v1/${table}`, fieldsToSet(this, index));

  return [{ json: record as IDataObject, pairedItem: { item: index } }];
}
