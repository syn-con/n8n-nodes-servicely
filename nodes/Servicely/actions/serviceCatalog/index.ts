import type { INodeProperties } from 'n8n-workflow';

import * as createRequest from './createRequest.operation';

export { createRequest };

/**
 * Properties for the Service Catalog resource: raising a request against a
 * published catalog item through the instance's Service Catalog controller
 * (`POST {instanceUrl}/controller/ServiceCatalog`), which decides for itself
 * where the request record goes and how each answer is stored.
 *
 * The Catalog Item picker sits above the answers: everything the request carries
 * hangs off which item it is for.
 */
export const description: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: { resource: ['serviceCatalog'] } },
    options: [
      {
        name: 'Create Request',
        value: 'createRequest',
        action: 'Create a catalog request',
        description: 'Raise a request against a service catalog item',
      },
    ],
    default: 'createRequest',
  },
  ...createRequest.description,
];
