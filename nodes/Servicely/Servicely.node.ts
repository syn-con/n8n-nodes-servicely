import type { IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';

import { router } from './actions/router';
import { versionDescription } from './actions/versionDescription';
import { listSearchMethods } from './SearchFunctions';

/**
 * The Servicely action node. Its property tree and operation logic live under
 * `actions/`: one folder per resource, one file per operation.
 */
// eslint-disable-next-line @n8n/community-nodes/icon-validation -- the icon is declared in versionDescription.ts, which the rule cannot follow from here
export class Servicely implements INodeType {
  description: INodeTypeDescription = versionDescription;

  /** Dynamic-option loaders backing the resourceLocator "From List" modes. */
  methods = listSearchMethods;

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    return router.call(this);
  }
}
