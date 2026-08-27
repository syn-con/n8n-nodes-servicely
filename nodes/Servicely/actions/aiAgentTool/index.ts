import type { INodeProperties } from 'n8n-workflow';

import * as sendResponse from './sendResponse.operation';

export { sendResponse };

/**
 * Properties for the AI Agent Tool resource: answer a call the Servicely AI Agent
 * Tool Trigger let in. The odd one out among the resources — it talks to the agent
 * waiting on the open request rather than to the Servicely API, which is why it
 * needs no credential (see `Servicely.node.ts`) and shows no Request Options.
 *
 * It lives here, on the action node, because a package may register only one
 * regular node; it was its own `servicelyAiAgentTool` node until 1.2.0.
 */
export const description: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: { resource: ['aiAgentTool'] } },
    options: [
      {
        name: 'Send Response',
        value: 'sendResponse',
        action: 'Send a response to the AI agent',
        description: 'Answer the agent that called the tool',
      },
    ],
    default: 'sendResponse',
  },
  ...sendResponse.description,
];
