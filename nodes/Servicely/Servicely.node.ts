import {
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
  NodeConnectionTypes,
} from 'n8n-workflow';

import { properties } from './actions/properties';
import { router } from './actions/router';
import { listSearchMethods } from './SearchFunctions';

/**
 * The Servicely action node. The node itself is declared here; its fields and the
 * logic behind them live under `actions/`: one folder per resource, one file per
 * operation, composed into {@link properties}.
 */
export class Servicely implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Servicely',
    name: 'servicely',
    icon: { light: 'file:../../icons/servicely.svg', dark: 'file:../../icons/servicely.dark.svg' },
    group: ['transform'],
    usableAsTool: true,
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: 'Read and write records and attachments in Servicely via the JSON REST API',
    documentationUrl: 'https://docs-servicely.atlassian.net/wiki/spaces/SD/pages/2077523978',
    defaults: { name: 'Servicely' },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    // Required for every resource that calls the API, which is all of them except
    // AI Agent Tool: that one answers the request a tool call is still holding
    // open, and never talks to the instance.
    credentials: [
      {
        name: 'servicelyApi',
        required: true,
        displayOptions: { hide: { resource: ['aiAgentTool'] } },
      },
    ],
    properties,
  };

  /** Dynamic-option loaders backing the resourceLocator "From List" modes. */
  methods = listSearchMethods;

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    return router.call(this);
  }
}
