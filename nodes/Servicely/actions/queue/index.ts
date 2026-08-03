import type { INodeProperties } from 'n8n-workflow';

import * as replyFailure from './replyFailure.operation';
import * as replySuccess from './replySuccess.operation';

export { replyFailure, replySuccess };

/**
 * Properties for the Queue resource: acknowledge a message that the Servicely
 * Trigger dequeued, back to the Async Integration controller (the counterpart of
 * the Node-RED Success/Failure reply nodes).
 */
export const description: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: { resource: ['queue'] } },
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
  ...replyFailure.description,
  ...replySuccess.description,
];
