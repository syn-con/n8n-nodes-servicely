import type { INodeProperties } from 'n8n-workflow';

import * as batchSearch from './batchSearch.operation';
import * as search from './search.operation';

export { batchSearch, search };

/**
 * Properties for the Global Search resource: full-text search over a table
 * through the instance's Global Search controller
 * (`POST {instanceUrl}/controller/GlobalSearch`), rather than through a `/v1`
 * query. Both operations send the same Table + Search Text pair; Batch Search
 * adds a limit.
 */
export const description: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: { resource: ['globalSearch'] } },
    options: [
      {
        name: 'Search',
        value: 'search',
        action: 'Search a table',
        description: 'Search one table for the given text',
      },
      {
        name: 'Batch Search',
        value: 'batchSearch',
        action: 'Batch search a table',
        description: 'Search one table for the given text, capped at a limit',
      },
    ],
    default: 'search',
  },
  ...search.description,
  ...batchSearch.description,
];
