import {
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeProperties,
  updateDisplayOptions,
} from 'n8n-workflow';

import { GLOBAL_SEARCH_REQUESTS } from '../../constants';
import { limitProperty } from '../common.descriptions';
import { globalSearch, searchProperties } from './request';

const properties: INodeProperties[] = [
  ...searchProperties,
  { ...limitProperty, description: 'Max number of hits to return' },
];

export const description = updateDisplayOptions(
  { show: { resource: ['globalSearch'], operation: ['batchSearch'] } },
  properties,
);

export async function execute(this: IExecuteFunctions, index: number): Promise<INodeExecutionData[]> {
  // Same request as Search, with the batch size the API caps the hits at.
  const limit = Number(this.getNodeParameter('limit', index, limitProperty.default));

  return globalSearch.call(this, index, GLOBAL_SEARCH_REQUESTS.batch, { limit });
}
