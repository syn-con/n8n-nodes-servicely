import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { ASYNC_INTEGRATION_PATH, QUEUE_IDENTIFIER } from '../../constants';
import { servicelyApiRequest } from '../../GenericFunctions';

/**
 * The acknowledgement both Queue operations share. Reply Success and Reply
 * Failure differ only in the `action`/`status` pair sent to the Async
 * Integration controller, matching the Node-RED reply nodes.
 */

/** Properties common to both reply operations. */
export const replyProperties: INodeProperties[] = [
  {
    displayName: 'Reply To',
    name: 'replyTo',
    type: 'string',
    default: '={{ $json._servicely.replyTo }}',
    required: true,
    description: 'ID of the message to acknowledge. The Servicely Trigger emits this as _servicely.replyTo on each item.',
  },
  {
    displayName: 'Payload',
    name: 'payload',
    type: 'json',
    default: '={{ $json }}',
    description: 'Response payload sent back to Servicely with the acknowledgement',
  },
];

/** Acknowledge a dequeued message with the given outcome. */
export async function reply(
  this: IExecuteFunctions,
  index: number,
  action: 'success' | 'fail',
  status: 'ok' | 'error',
): Promise<INodeExecutionData[]> {
  const replyTo = this.getNodeParameter('replyTo', index, '') as string;

  await servicelyApiRequest.call(this, 'POST', ASYNC_INTEGRATION_PATH, {
    reply_to: replyTo,
    action,
    identifier: QUEUE_IDENTIFIER,
    status,
    payload: this.getNodeParameter('payload', index, {}),
  });

  return [{ json: { success: true, replyTo, action }, pairedItem: { item: index } }];
}
