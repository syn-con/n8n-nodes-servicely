import {
  type IDataObject,
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeProperties,
  NodeOperationError,
  updateDisplayOptions,
} from 'n8n-workflow';

import { CONTROLLER_PATH_PREFIX } from '../../constants';
import { locator, servicelyApiRequest, toItems } from '../../GenericFunctions';
import { searchResourceLocator } from '../common.descriptions';

const properties: INodeProperties[] = [
  searchResourceLocator({
    name: 'controllerName',
    displayName: 'Controller',
    description: 'Controller to invoke. The list is loaded from the SystemController table; the stored value is the controller name used in the URL.',
    searchListMethod: 'searchControllers',
    manualHint: 'Enter a controller name (e.g. AsyncIntegration) or an expression',
    manualPlaceholder: 'AsyncIntegration',
  }),
  {
    displayName: 'Body (JSON)',
    name: 'body',
    type: 'json',
    default: '{}',
    description: 'Raw JSON request body posted to the controller. Its shape is entirely up to the controller.',
  },
];

export const description = updateDisplayOptions(
  // `call` alongside `invoke`: the operation was called that before, and a workflow
  // holding the old value has to keep showing the fields it fills in
  { show: { resource: ['controller'], operation: ['invoke', 'call'] } },
  properties,
);

/**
 * The Body field is a `json` property, so it arrives as a string when typed and
 * as a real object when it comes from an expression. Anything that is not a JSON
 * object (a bare array, string, or number) is rejected rather than posted, since
 * a controller expects a named-parameter object.
 */
function requestBody(ctx: IExecuteFunctions, index: number): IDataObject {
  const raw = ctx.getNodeParameter('body', index, '{}') as string | IDataObject;

  if (typeof raw !== 'string') {
    return raw ?? {};
  }
  if (raw.trim() === '') {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new NodeOperationError(ctx.getNode(), `Invalid Body JSON: ${(error as Error).message}`, { itemIndex: index });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new NodeOperationError(ctx.getNode(), 'Body must be a JSON object', { itemIndex: index });
  }
  return parsed as IDataObject;
}

export async function execute(this: IExecuteFunctions, index: number): Promise<INodeExecutionData[]> {
  const controller = locator(this, 'controllerName', index);
  if (!controller) {
    throw new NodeOperationError(this.getNode(), 'No controller selected', { itemIndex: index });
  }

  const payload = await servicelyApiRequest.call(
    this,
    'POST',
    `${CONTROLLER_PATH_PREFIX}/${controller}`,
    requestBody(this, index),
  );

  return toItems(payload, index);
}
