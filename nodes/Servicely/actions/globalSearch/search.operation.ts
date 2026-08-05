import { type IExecuteFunctions, type INodeExecutionData, updateDisplayOptions } from 'n8n-workflow';

import { GLOBAL_SEARCH_REQUESTS } from '../../constants';
import { globalSearch, searchProperties } from './request';

export const description = updateDisplayOptions(
  { show: { resource: ['globalSearch'], operation: ['search'] } },
  searchProperties,
);

export async function execute(this: IExecuteFunctions, index: number): Promise<INodeExecutionData[]> {
  return globalSearch.call(this, index, GLOBAL_SEARCH_REQUESTS.search);
}
