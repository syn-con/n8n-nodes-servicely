import type { INodeProperties } from 'n8n-workflow';

const showForQueue = { resource: ['queue'] };

/**
 * Properties for the Queue resource: acknowledge a message that the Servicely
 * Trigger dequeued, back to the Async Integration controller (the counterpart
 * of the Node-RED Success/Failure reply nodes).
 */
export const queueProperties: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: showForQueue },
    options: [
      {
        name: 'Reply Success',
        value: 'replySuccess',
        action: 'Acknowledge a message as succeeded',
        description: 'Acknowledge a dequeued message as processed successfully (success/ok)',
      },
      {
        name: 'Reply Failure',
        value: 'replyFailure',
        action: 'Acknowledge a message as failed',
        description: 'Acknowledge a dequeued message as failed (fail/error)',
      },
    ],
    default: 'replySuccess',
  },
  {
    displayName: 'Reply To',
    name: 'replyTo',
    type: 'string',
    default: '={{ $json._servicely.replyTo }}',
    required: true,
    description: 'Id of the message to acknowledge. The Servicely Trigger emits this as _servicely.replyTo on each item.',
    displayOptions: { show: showForQueue },
  },
  {
    displayName: 'Payload',
    name: 'payload',
    type: 'json',
    default: '={{ $json }}',
    description: 'Response payload sent back to Servicely with the acknowledgement',
    displayOptions: { show: showForQueue },
  },
];
