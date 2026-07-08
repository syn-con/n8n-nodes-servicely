import type { IDataObject, IExecuteFunctions, INodeExecutionData, IPollFunctions } from 'n8n-workflow';

import { DEFAULT_DEQUEUE_COUNT } from '../constants';
import type { AsyncQueueMessage, DequeueRequest, IServicelyQueueClient, QueueReplyRequest } from '../types';

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

/**
 * Map one claimed message to an n8n item. A JSON object payload becomes the
 * item's `json` directly; anything else is wrapped under `payload`. Reply
 * metadata is attached under `_servicely` so a later ack step can target this
 * message (dequeue is at-least-once until acknowledged).
 */
function toItem(message: AsyncQueueMessage, request: DequeueRequest): INodeExecutionData {
  const parsed = parseQueuePayload(message.payload);
  const json: Record<string, unknown> =
    parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { ...(parsed as Record<string, unknown>) }
      : { payload: parsed };
  json._servicely = { replyTo: message.id, queue: request.queue, subject: request.subject };
  return { json: json as IDataObject };
}

/** Dequeue messages from the Async Integration queue and emit one item each. */
export async function pollQueue(ctx: IPollFunctions, client: IServicelyQueueClient): Promise<INodeExecutionData[]> {
  const request: DequeueRequest = {
    queue: String(ctx.getNodeParameter('queue', '', { extractValue: true }) ?? '').trim(),
    subject: String(ctx.getNodeParameter('subject', '', { extractValue: true }) ?? '').trim(),
    requestCount: ctx.getNodeParameter('requestCount', DEFAULT_DEQUEUE_COUNT) as number,
  };
  const messages = await client.dequeue(request);
  return messages.map((message) => toItem(message, request));
}

/** action/status pair for each reply operation, mirroring the Node-RED reply nodes. */
const REPLY_OUTCOMES: Record<string, Pick<QueueReplyRequest, 'action' | 'status'>> = {
  replySuccess: { action: 'success', status: 'ok' },
  replyFailure: { action: 'fail', status: 'error' },
};

/** Acknowledge a dequeued message back to Servicely (Queue → Reply Success/Failure). */
export async function executeQueueOperation(
  ctx: IExecuteFunctions,
  client: IServicelyQueueClient,
  operation: string,
  i: number,
): Promise<INodeExecutionData[]> {
  const outcome = REPLY_OUTCOMES[operation];
  if (!outcome) {
    throw new Error(`Unsupported Queue operation: ${operation}`);
  }
  const replyTo = ctx.getNodeParameter('replyTo', i, '') as string;
  const payload = ctx.getNodeParameter('payload', i, {}) as unknown;
  await client.reply({ replyTo, action: outcome.action, status: outcome.status, payload });
  return [{ json: { success: true, replyTo, action: outcome.action } }];
}
