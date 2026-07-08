import {
  type IDataObject,
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
  NodeConnectionTypes,
  NodeOperationError,
} from 'n8n-workflow';

import { DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS } from './constants';
import { ServicelyError } from './errors';
import { executeAttachmentOperation } from './handlers/attachment.handler';
import { executeObjectOperation } from './handlers/object.handler';
import { executeQueueOperation } from './handlers/queue.handler';
import { nodeMethods } from './methods';
import type { ApiClient } from './transport/ApiClient';
import { buildClient } from './transport/clientFactory';
import { attachmentProperties } from './descriptions/attachment.properties';
import { commonProperties } from './descriptions/common.properties';
import { objectProperties } from './descriptions/object.properties';
import { queueProperties } from './descriptions/queue.properties';

/** A resource's operation router. `ApiClient` satisfies every handler's client interface. */
type ResourceRunner = (
  ctx: IExecuteFunctions,
  client: ApiClient,
  operation: string,
  i: number,
) => Promise<INodeExecutionData[]>;

const RESOURCE_RUNNERS: Record<string, ResourceRunner> = {
  object: executeObjectOperation,
  attachment: executeAttachmentOperation,
  queue: executeQueueOperation,
};

/** Wrap any thrown error in n8n's NodeOperationError for display. */
function toNodeError(ctx: IExecuteFunctions, error: unknown, itemIndex: number): NodeOperationError {
  if (error instanceof NodeOperationError) {
    return error;
  }
  const description = error instanceof ServicelyError ? `HTTP ${error.statusCode} at ${error.endpoint}` : undefined;
  return new NodeOperationError(ctx.getNode(), error as Error, { itemIndex, description });
}

export class Servicely implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Servicely',
    name: 'servicely',
    icon: { light: 'file:../../icons/servicely.svg', dark: 'file:../../icons/servicely.dark.svg' },
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: 'Read and write records and attachments in Servicely via the JSON REST API',
    documentationUrl: 'https://docs-servicely.atlassian.net/wiki/spaces/SD/pages/2077523978',
    defaults: { name: 'Servicely' },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: 'servicelyApi', required: true }],
    properties: [
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'Object', value: 'object' },
          { name: 'Attachment', value: 'attachment' },
          { name: 'Queue', value: 'queue' },
        ],
        default: 'object',
      },
      ...objectProperties,
      ...attachmentProperties,
      ...queueProperties,
      ...commonProperties,
    ],
  };

  /** Dynamic-option loaders backing the resourceLocator "From List" modes. */
  methods = nodeMethods;

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const resource = this.getNodeParameter('resource', 0) as string;
    const operation = this.getNodeParameter('operation', 0) as string;

    const requestOptions = this.getNodeParameter('requestOptions', 0, {}) as IDataObject;
    const timeout = (requestOptions.timeout as number) ?? DEFAULT_TIMEOUT_MS;
    const maxRetries = (requestOptions.maxRetries as number) ?? DEFAULT_MAX_RETRIES;
    const client = await buildClient(this, { timeout, maxRetries });

    const runOperation = RESOURCE_RUNNERS[resource] ?? executeObjectOperation;
    const returnData: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      try {
        // eslint-disable-next-line no-await-in-loop -- input items are processed sequentially
        const result = await runOperation(this, client, operation, i);
        returnData.push(...result);
      } catch (error) {
        if (this.continueOnFail()) {
          returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
          continue;
        }
        throw toNodeError(this, error, i);
      }
    }

    return [returnData];
  }
}
