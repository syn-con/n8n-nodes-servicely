import type { INodeProperties } from 'n8n-workflow';

import * as create from './create.operation';
import * as del from './delete.operation';
import * as get from './get.operation';
import * as getAll from './getAll.operation';
import * as update from './update.operation';
import { tableResourceLocator } from '../common.descriptions';

export { create, del as delete, get, getAll, update };

/** Properties for the Object resource: the operation selector, the shared Table
 * reference, then each operation's own fields. */
export const description: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: { resource: ['object'] } },
    options: [
      { name: 'Create', value: 'create', action: 'Create a record', description: 'Create a new record (POST)' },
      { name: 'Delete', value: 'delete', action: 'Delete a record', description: 'Delete a record by ID (DELETE)' },
      { name: 'Get', value: 'get', action: 'Get a record', description: 'Retrieve a single record by ID (GET)' },
      { name: 'Get Many', value: 'getAll', action: 'Get many records', description: 'Retrieve a list of records (GET)' },
      { name: 'Update', value: 'update', action: 'Update a record', description: 'Update fields on a record (PATCH)' },
    ],
    default: 'getAll',
  },
  {
    ...tableResourceLocator({
      name: 'tableName',
      displayName: 'Table',
      description: 'Servicely table to operate on (e.g. Incident, ITSMRequest, User, Group)',
      default: 'Incident',
    }),
    displayOptions: { show: { resource: ['object'] } },
  },
  ...create.description,
  ...del.description,
  ...get.description,
  ...getAll.description,
  ...update.description,
];
