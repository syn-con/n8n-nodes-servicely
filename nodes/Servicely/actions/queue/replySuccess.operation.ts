import { type IExecuteFunctions, type INodeExecutionData, updateDisplayOptions } from 'n8n-workflow';

import { reply, replyProperties } from './reply';

export const description = updateDisplayOptions(
  { show: { resource: ['queue'], operation: ['replySuccess'] } },
  replyProperties,
);

export async function execute(this: IExecuteFunctions, index: number): Promise<INodeExecutionData[]> {
  return reply.call(this, index, 'success', 'ok');
}
