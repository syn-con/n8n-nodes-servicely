import {
  type IDataObject,
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeProperties,
  updateDisplayOptions,
} from 'n8n-workflow';

import { buildSelectors, locator, servicelyApiRequest } from '../../GenericFunctions';
import { recordResourceLocator, selectorOptionsProperty } from '../common.descriptions';

const properties: INodeProperties[] = [
  recordResourceLocator({
    name: 'recordId',
    displayName: 'Record',
    description: 'The record to retrieve',
    searchListMethod: 'searchObjectRecords',
  }),
  selectorOptionsProperty,
];

export const description = updateDisplayOptions({ show: { resource: ['object'], operation: ['get'] } }, properties);

export async function execute(this: IExecuteFunctions, index: number): Promise<INodeExecutionData[]> {
  const table = locator(this, 'tableName', index);
  const id = locator(this, 'recordId', index);
  const record = await servicelyApiRequest.call(
    this,
    'GET',
    `/v1/${table}/${id}`,
    undefined,
    buildSelectors(this, index),
  );

  return [{ json: record as IDataObject, pairedItem: { item: index } }];
}
