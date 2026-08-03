import {
  type IDataObject,
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeProperties,
  updateDisplayOptions,
} from 'n8n-workflow';

import {
  buildListQuery,
  locator,
  servicelyApiRequest,
  servicelyApiRequestAllItems,
  toRecordList,
} from '../../GenericFunctions';
import { filtersProperty, limitProperty, listOptionsProperty } from '../common.descriptions';

const properties: INodeProperties[] = [
  {
    displayName: 'Return All',
    name: 'returnAll',
    type: 'boolean',
    default: false,
    description: 'Whether to return all results by paging through them, or only up to a given limit',
  },
  { ...limitProperty, displayOptions: { show: { returnAll: [false] } } },
  filtersProperty,
  listOptionsProperty,
];

export const description = updateDisplayOptions({ show: { resource: ['object'], operation: ['getAll'] } }, properties);

export async function execute(this: IExecuteFunctions, index: number): Promise<INodeExecutionData[]> {
  const endpoint = `/v1/${locator(this, 'tableName', index)}`;
  const qs = buildListQuery(this, index);
  const pairedItem = { item: index };

  if (this.getNodeParameter('returnAll', index, false) as boolean) {
    const records = await servicelyApiRequestAllItems.call(this, endpoint, qs);
    return records.map((json) => ({ json, pairedItem }));
  }

  const limit = this.getNodeParameter('limit', index, 50) as number;
  const records = toRecordList<IDataObject>(
    await servicelyApiRequest.call(this, 'GET', endpoint, undefined, { ...qs, page: 1, page_size: limit }),
  );

  return records.slice(0, limit).map((json) => ({ json, pairedItem }));
}
