import {
  type IDataObject,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
  type IPollFunctions,
  NodeConnectionTypes,
} from 'n8n-workflow';

import { DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS } from './constants';
import { commonProperties } from './descriptions/common.properties';
import { triggerProperties } from './descriptions/trigger.properties';
import { pollObjects } from './handlers/polling.handler';
import { pollQueue } from './handlers/queue.handler';
import { nodeMethods } from './methods';
import { buildClient } from './transport/clientFactory';

/**
 * Polling trigger for Servicely. On each scheduled poll it either dequeues
 * messages from an Async Integration queue or fetches table records matching a
 * filter, emitting one item per message/record. n8n manages the schedule via
 * the auto-injected Poll Times field (`polling: true`).
 */
export class ServicelyTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Servicely Trigger',
    name: 'servicelyTrigger',
    icon: { light: 'file:../../icons/servicely.svg', dark: 'file:../../icons/servicely.dark.svg' },
    group: ['trigger'],
    version: 1,
    subtitle: '={{$parameter["triggerOn"]}}',
    description: 'Poll a Servicely async queue or table on a schedule',
    documentationUrl: 'https://docs-servicely.atlassian.net/wiki/spaces/SD/pages/2077523978',
    defaults: { name: 'Servicely Trigger' },
    polling: true,
    inputs: [],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: 'servicelyApi', required: true }],
    properties: [...triggerProperties, ...commonProperties],
  };

  /** Reuse the shared dynamic-option loaders (Table "From List" picker). */
  methods = nodeMethods;

  async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
    const requestOptions = this.getNodeParameter('requestOptions', {}) as IDataObject;
    const timeout = (requestOptions.timeout as number) ?? DEFAULT_TIMEOUT_MS;
    const maxRetries = (requestOptions.maxRetries as number) ?? DEFAULT_MAX_RETRIES;
    const client = await buildClient(this, { timeout, maxRetries });

    const triggerOn = this.getNodeParameter('triggerOn', 'queue') as string;
    const items = triggerOn === 'queue' ? await pollQueue(this, client) : await pollObjects(this, client);

    // Returning null tells n8n "nothing new this poll", so no execution starts.
    return items.length > 0 ? [items] : null;
  }
}
