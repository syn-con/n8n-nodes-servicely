import {
  type IDataObject,
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeProperties,
  type ResourceMapperValue,
  updateDisplayOptions,
  NodeOperationError,
} from 'n8n-workflow';

import { SERVICE_CATALOG_PATH } from '../../constants';
import { locator, servicelyApiRequest, toItems } from '../../GenericFunctions';
import { recordResourceLocator } from '../common.descriptions';

const properties: INodeProperties[] = [
  recordResourceLocator({
    name: 'catalogItemId',
    displayName: 'Catalog Item',
    description: 'Published catalog item the request is for',
    searchListMethod: 'searchCatalogItems',
  }),
  {
    displayName: 'Questions',
    name: 'questions',
    type: 'resourceMapper',
    default: { mappingMode: 'defineBelow', value: null },
    required: true,
    description: 'Answers to the questions the selected catalog item asks',
    typeOptions: {
      // The locator's inner `.value`, so choosing another item reloads the form
      // instead of leaving the previous item's questions on screen
      loadOptionsDependsOn: ['catalogItemId.value'],
      resourceMapper: {
        resourceMapperMethod: 'getCatalogItemQuestions',
        mode: 'add',
        valuesLabel: 'Answers',
        // An answer is typed in against a question the item asks; there is no
        // incoming column to line it up with, so there is nothing to auto-map
        supportAutoMap: false,
        fieldWords: { singular: 'question', plural: 'questions' },
        addAllFields: true,
      },
    },
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['serviceCatalog'], operation: ['createRequest'] } },
  properties,
);

/**
 * The answers the mapper collected, keyed by the question's record id — which is
 * what the mapper's schema uses as each field's `id`, and what the controller
 * keys its `answers` object by. An answer left blank is dropped rather than sent
 * as an empty string, so an optional question that was skipped stays unanswered.
 */
export function answers(ctx: IExecuteFunctions, index: number): IDataObject {
  const mapped = ctx.getNodeParameter('questions', index, {}) as Partial<ResourceMapperValue>;
  const collected: IDataObject = {};
  for (const [questionId, value] of Object.entries(mapped.value ?? {})) {
    if (value !== null && value !== undefined && value !== '') {
      collected[questionId] = value;
    }
  }
  return collected;
}

/**
 * Raise a request against a catalog item.
 *
 * One POST to the Service Catalog controller, carrying the item and the answers
 * keyed by question id. Everything the request *is* — which table the record
 * goes in, what carries the item's name, how an answer is stored — is the
 * instance's to decide, so none of it is read or written from here: a stale item
 * id or a rejected answer comes back as the controller's own error, and there is
 * no partly built request to leave behind.
 */
export async function execute(this: IExecuteFunctions, index: number): Promise<INodeExecutionData[]> {
  const catalogItemId = locator(this, 'catalogItemId', index).trim();
  if (!catalogItemId) {
    throw new NodeOperationError(this.getNode(), 'No catalog item selected', { itemIndex: index });
  }

  const payload = await servicelyApiRequest.call(this, 'POST', SERVICE_CATALOG_PATH, {
    catalogItem: catalogItemId,
    answers: answers(this, index),
  });

  return toItems(payload, index);
}
