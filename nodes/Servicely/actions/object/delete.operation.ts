import {
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeProperties,
  updateDisplayOptions,
} from 'n8n-workflow';

import { locatorLabel, servicelyApiRequest, stringParam } from '../../GenericFunctions';
import { recordIdProperty } from '../common.descriptions';

const properties: INodeProperties[] = [recordIdProperty('ID of the record to delete')];

export const description = updateDisplayOptions(
  { show: { resource: ['object'], operation: ['delete'] } },
  properties,
);

export async function execute(this: IExecuteFunctions, index: number): Promise<INodeExecutionData[]> {
  const table = locatorLabel(this, 'tableName', index);
  const id = stringParam(this, 'recordId', index);
  await servicelyApiRequest.call(this, 'DELETE', `/v1/${table}/${id}`);

  return [{ json: { success: true, table, id }, pairedItem: { item: index } }];
}

