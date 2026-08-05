import {
  type IDataObject,
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeProperties,
  updateDisplayOptions,
} from 'n8n-workflow';

import { buildSelectors, locatorLabel, servicelyApiRequest, stringParam } from '../../GenericFunctions';
import { idProperty, selectorOptionsProperty } from '../common.descriptions';

const properties: INodeProperties[] = [
  idProperty({ name: 'recordId', displayName: 'Record ID', description: 'ID of the record to retrieve' }),
  selectorOptionsProperty,
];

export const description = updateDisplayOptions({ show: { resource: ['object'], operation: ['get'] } }, properties);

export async function execute(this: IExecuteFunctions, index: number): Promise<INodeExecutionData[]> {
  const table = locatorLabel(this, 'tableName', index);
  const id = stringParam(this, 'recordId', index);
  const record = await servicelyApiRequest.call(
    this,
    'GET',
    `/v1/${table}/${id}`,
    undefined,
    buildSelectors(this, index),
  );

  return [{ json: record as IDataObject, pairedItem: { item: index } }];
}
