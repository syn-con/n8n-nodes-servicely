import type { IDataObject, IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { GLOBAL_SEARCH_PATH, type GlobalSearchRequestType } from '../../constants';
import { locator, servicelyApiRequest, stringParam, toItems } from '../../GenericFunctions';
import { searchResourceLocator } from '../common.descriptions';

/**
 * The request both Global Search operations send. They post to the same
 * controller with the same Table + Search Text pair, and differ in the
 * `request_type` that names the call plus the extra body keys they add — Batch
 * Search carries a `limit`.
 */

/** Properties common to both search operations. */
export const searchProperties: INodeProperties[] = [
  searchResourceLocator({
    name: 'tableClass',
    displayName: 'Table',
    description: 'Table to search. The list is the Global Search controller\'s own configuration (request_type "search_config"); the selected table is sent as table_class.',
    searchListMethod: 'searchGlobalSearchTables',
    manualHint: 'Enter a table class or an expression',
    manualPlaceholder: 'Incident',
  }),
  {
    displayName: 'Search Text',
    name: 'text',
    type: 'string',
    default: '',
    required: true,
    description: 'Text to search for',
  },
];

/**
 * Post one Global Search request under the given `request_type`. `extra` carries
 * whatever else the operation adds on top of the shared body; the response is
 * shaped like any other controller answer, so a list of hits fans out to one
 * item each.
 */
export async function globalSearch(
  this: IExecuteFunctions,
  index: number,
  requestType: GlobalSearchRequestType,
  extra: IDataObject = {},
): Promise<INodeExecutionData[]> {
  const payload = await servicelyApiRequest.call(this, 'POST', GLOBAL_SEARCH_PATH, {
    request_type: requestType,
    table_class: locator(this, 'tableClass', index),
    text: stringParam(this, 'text', index),
    ...extra,
  });

  return toItems(payload, index);
}
