import { type IExecuteFunctions, type INodeExecutionData, NodeError, NodeOperationError } from 'n8n-workflow';

import * as attachment from './attachment';
import * as controller from './controller';
import * as globalSearch from './globalSearch';
import type { Servicely } from './node.type';
import * as object from './object';
import * as queue from './queue';
import { versionDescription } from './versionDescription';

/** One operation module: its property fragment and its per-item executor. */
interface Action {
  execute: (this: IExecuteFunctions, index: number) => Promise<INodeExecutionData[]>;
}

/**
 * Resolve the operation module for a resource/operation pair. The switch is
 * exhaustive over the union in node.type.ts, so a resource folder that gains an
 * operation without registering it there fails to compile.
 */
function actionFor(servicely: Servicely): Action | undefined {
  switch (servicely.resource) {
    case 'object':
      return object[servicely.operation];
    case 'attachment':
      return attachment[servicely.operation];
    case 'queue':
      return queue[servicely.operation];
    case 'controller':
      return controller[servicely.operation];
    case 'globalSearch':
      return globalSearch[servicely.operation];
    default:
      return undefined;
  }
}

/**
 * The `default` a selector declares in the node description, for use as a
 * `getNodeParameter` fallback.
 *
 * n8n saves only the parameters whose value differs from their declared default,
 * so a selector the user left alone is absent from `node.parameters` altogether —
 * and a single-option selector (Controller's only operation is "Call") can never
 * be present at all. Reading one without a fallback fails the execution with
 * n8n's internal `Could not get parameter "operation"`. Taking the fallback from
 * the description keeps it from drifting away from what the UI shows.
 */
function declaredDefault(name: string, resource?: string): string {
  const property = versionDescription.properties.find((candidate) => {
    if (candidate.name !== name) {
      return false;
    }
    const shownFor = candidate.displayOptions?.show?.resource as string[] | undefined;
    return resource === undefined || (shownFor?.includes(resource) ?? false);
  });

  // '' rather than undefined: an unknown resource must reach the unsupported-pair
  // check below, which names both halves, instead of throwing on the read.
  return (property?.default as string | undefined) ?? '';
}

/**
 * Dispatch each input item to the selected operation module and collect the
 * results. Owning the item loop here keeps the `continueOnFail` and
 * error-wrapping contract in one place, so an operation only handles one item.
 */
export async function router(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
  const items = this.getInputData();
  const returnData: INodeExecutionData[] = [];

  const resource = this.getNodeParameter(
    'resource',
    0,
    declaredDefault('resource'),
  ) as Servicely['resource'];
  const operation = this.getNodeParameter(
    'operation',
    0,
    declaredDefault('operation', resource),
  ) as Servicely['operation'];

  // A workflow saved against a different version can still name a pair we do not
  // have, so the compile-time union is backed by a runtime check.
  const action = actionFor({ resource, operation } as Servicely);
  if (typeof action?.execute !== 'function') {
    throw new NodeOperationError(
      this.getNode(),
      `The operation "${operation}" is not supported for resource "${resource}"`,
    );
  }

  /* eslint-disable no-await-in-loop -- input items are processed sequentially */
  for (let i = 0; i < items.length; i++) {
    try {
      returnData.push(...(await action.execute.call(this, i)));
    } catch (error) {
      if (this.continueOnFail()) {
        returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
        continue;
      }
      throw error instanceof NodeError
        ? error
        : new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
    }
  }
  /* eslint-enable no-await-in-loop */

  return [returnData];
}
