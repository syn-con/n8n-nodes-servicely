import {
  type IDataObject,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
  type IPollFunctions,
  NodeConnectionTypes,
} from 'n8n-workflow';

import {
  filtersProperty,
  limitProperty,
  listOptionsProperty,
  requestOptionsProperty,
  searchResourceLocator,
  tableResourceLocator,
} from './actions/common.descriptions';
import { ASYNC_INTEGRATION_PATH, DEFAULT_DEQUEUE_COUNT, QUEUE_IDENTIFIER } from './constants';
import { buildListQuery, servicelyApiRequest, toRecordList } from './GenericFunctions';
import { listSearchMethods } from './SearchFunctions';
import type { ServicelyRecord } from './types';

/** A single message claimed from an async queue; `id` is its `reply_to`. */
interface AsyncQueueMessage {
  id: string;
  payload?: unknown;
}

const showForQueue = { triggerOn: ['queue'] };
const showForObject = { triggerOn: ['object'] };

/**
 * Decode a message payload. Servicely often stores the payload as a JSON
 * object/array encoded as a string; mirror the Node-RED node by parsing those
 * back into structured data while leaving plain strings untouched.
 */
export function parseQueuePayload(payload: unknown): unknown {
  if (typeof payload !== 'string') {
    return payload;
  }
  const trimmed = payload.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return payload;
    }
  }
  return payload;
}

/** Read a resourceLocator's resolved value off the poll context. */
function locator(ctx: IPollFunctions, name: string): string {
  return String(ctx.getNodeParameter(name, '', { extractValue: true }) ?? '').trim();
}

/**
 * Polling trigger for Servicely. On each scheduled poll it either dequeues
 * messages from an Async Integration queue or fetches table records matching a
 * filter, emitting one item per message/record. n8n manages the schedule via
 * the auto-injected Poll Times field (`polling: true`).
 *
 * A trigger has no resource/operation pair, so unlike the action node it is not
 * routed through `actions/` — but it reuses the same shared property fragments.
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
    properties: [
      {
        displayName: 'Trigger On',
        name: 'triggerOn',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'Async Queue Message',
            value: 'queue',
            description: 'Dequeue messages from a Servicely Async Integration queue',
          },
          {
            name: 'Object (Table Records)',
            value: 'object',
            description: 'Poll a table for records matching a filter',
          },
        ],
        default: 'queue',
      },

      // --- Async Queue ----------------------------------------------------
      {
        ...searchResourceLocator({
          name: 'queue',
          displayName: 'Queue',
          description: 'Async Integration queue to claim messages from. The list shows ActionProviderInstance records with ConnectionType "async_integration"; the selected ConnectionString is used as the queue.',
          searchListMethod: 'searchQueues',
          manualHint: 'Enter the queue ConnectionString or an expression',
          manualPlaceholder: 'my-integration-queue',
        }),
        displayOptions: { show: showForQueue },
      },
      {
        ...searchResourceLocator({
          name: 'subject',
          displayName: 'Action Name',
          description: "Action/subject identifying which messages to claim. The list shows Action records for the selected queue's provider instance; the selected Command is used as the subject.",
          searchListMethod: 'searchActions',
          manualHint: 'Enter the action command or an expression',
          manualPlaceholder: 'process-incident',
        }),
        displayOptions: { show: showForQueue },
      },
      {
        displayName: 'Messages Per Poll',
        name: 'requestCount',
        type: 'number',
        typeOptions: { minValue: 1 },
        default: DEFAULT_DEQUEUE_COUNT,
        description: 'Maximum number of messages to claim on each poll',
        displayOptions: { show: showForQueue },
      },

      // --- Object (table records) -----------------------------------------
      {
        ...tableResourceLocator({
          name: 'tableName',
          displayName: 'Table',
          description: 'Servicely table to poll (e.g. Incident, ITSMRequest, User, Group)',
          default: 'Incident',
        }),
        displayOptions: { show: showForObject },
      },
      {
        ...limitProperty,
        description: 'Max number of records to return on each poll',
        displayOptions: { show: showForObject },
      },
      { ...filtersProperty, displayOptions: { show: showForObject } },
      { ...listOptionsProperty, displayOptions: { show: showForObject } },

      requestOptionsProperty,
    ],
  };

  /** Reuse the shared dynamic-option loaders (Table, Queue, and Action pickers). */
  methods = listSearchMethods;

  async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
    const items: INodeExecutionData[] = [];

    if ((this.getNodeParameter('triggerOn', 'queue') as string) === 'queue') {
      const queue = locator(this, 'queue');
      const subject = locator(this, 'subject');
      const messages = toRecordList<AsyncQueueMessage>(
        await servicelyApiRequest.call(this, 'POST', ASYNC_INTEGRATION_PATH, {
          action: 'dequeue',
          identifier: QUEUE_IDENTIFIER,
          queue,
          subject,
          request_count: this.getNodeParameter('requestCount', DEFAULT_DEQUEUE_COUNT) as number,
        }),
      );

      for (const message of messages) {
        // A JSON object payload becomes the item's `json` directly; anything else
        // is wrapped under `payload`. Reply metadata goes under `_servicely` so a
        // later ack step can target this message (dequeue is at-least-once).
        const parsed = parseQueuePayload(message.payload);
        const json: IDataObject =
          parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
            ? { ...(parsed as IDataObject) }
            : { payload: parsed as IDataObject };
        json._servicely = { replyTo: message.id, queue, subject };
        items.push({ json });
      }
    } else {
      const limit = this.getNodeParameter('limit', 50) as number;
      const records = toRecordList<ServicelyRecord>(
        await servicelyApiRequest.call(this, 'GET', `/v1/${locator(this, 'tableName')}`, undefined, {
          ...buildListQuery(this),
          page: 1,
          page_size: limit,
        }),
      );
      items.push(...records.slice(0, limit).map((record) => ({ json: record as IDataObject })));
    }

    // Returning null tells n8n "nothing new this poll", so no execution starts.
    return items.length > 0 ? [items] : null;
  }
}
