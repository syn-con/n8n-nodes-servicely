import {
	type INodeProperties,
	type IWebhookFunctions,
	type NodeTypeAndVersion,
	WorkflowConfigurationError,
} from 'n8n-workflow';

import { DEFAULT_RESPONSE_TIMEOUT_SECONDS } from './parameters';
import { RESPONSE_NODE_TYPE, RESPONSE_RESOURCE } from './presentation';

/**
 * How the AI Agent Tool answers a call, modelled on n8n's own Webhook node
 * (`packages/nodes-base/nodes/Webhook`): the trigger itself never writes the
 * response for a mode that answers later. It only *declares* — in its webhook
 * description — the mode, the status code and what data to send, and n8n's
 * webhook layer does the answering.
 *
 * The description fields are expressions, evaluated per request against
 * `$parameter`. The two that read more than one parameter are written as
 * functions and interpolated into their expression, which is how the Webhook
 * node states the same rules once instead of twice.
 */

/** The parameters the response expressions read. */
export interface ResponseParameters {
	responseMode?: string;
	responseData?: string;
	options?: {
		responseCode?: number;
		responseData?: string;
		noResponseBody?: boolean;
	};
}

/**
 * The status code n8n answers with, for every mode that does not have a
 * Servicely node set to *AI Agent Tool* to take the decision.
 *
 * Interpolated into an expression, so it must stand on its own: no imports, no
 * helpers, nothing from this module's scope.
 */
export const getResponseCode = (parameters: ResponseParameters) => {
	const code = parameters.options?.responseCode;
	if (typeof code === 'number' && code >= 100 && code <= 599) {
		return code;
	}
	return 200;
};

/**
 * What n8n puts in the body, as the value the webhook layer knows:
 * `allEntries` / `firstEntryJson` for the last node's data, `noData` for an
 * empty body, a plain string for a fixed reply, or nothing — which leaves the
 * default for the mode (n8n falls back to `firstEntryJson` for *When Last Node
 * Finishes*, and to whatever `webhook()` returned as `webhookResponse` for
 * *Immediately*).
 *
 * `Using Servicely Node` answers nothing here on purpose: that node sends the
 * whole response, so a body declared next to it would be a second answer to the
 * same request.
 *
 * Interpolated into an expression — see {@link getResponseCode}.
 */
export const getResponseData = (parameters: ResponseParameters) => {
	const { responseMode, responseData, options } = parameters;

	if (responseMode === 'lastNode' && responseData) {
		return responseData;
	}

	if (responseMode === 'onReceived' && options?.responseData) {
		return options.responseData;
	}

	if (responseMode !== 'responseNode' && options?.noResponseBody) {
		return 'noData';
	}

	return undefined;
};

/**
 * Whether a node is the one that answers a tool call: the Servicely node with its
 * Resource set to *AI Agent Tool*. Until 1.2.0 this was a node type of its own,
 * and the type alone said so; the answer now lives on the action node, so the
 * parameter has to be read too — hence the `includeNodeParameters` below.
 *
 * `resource` is absent from a node left on its default, and that default is
 * `object`, so an unset parameter correctly reads as "not the responder".
 *
 * n8n prefixes a community node's type with the package it came from, and a
 * package can be installed under more than one name over a node's life, so the
 * suffix is what identifies it. The suffix is exact: `servicelyTrigger` and
 * `servicelyAiAgentToolTrigger` do not end in `.servicely`.
 */
function isResponseNode(node: NodeTypeAndVersion): boolean {
	const isActionNode =
		node.type === RESPONSE_NODE_TYPE || node.type.endsWith(`.${RESPONSE_NODE_TYPE}`);

	return isActionNode && node.parameters?.resource === RESPONSE_RESOURCE;
}

/**
 * Refuses a workflow whose Respond setting and wiring disagree, before the
 * request is let in — the Webhook node's `checkResponseModeConfiguration`.
 *
 * Both halves are the same mistake seen from either side. A tool set to answer
 * from a responder that has none would leave the agent waiting for an answer
 * nobody sends, and a responder under any other mode never gets to send the
 * answer it was configured with, because n8n has already replied by the time it
 * runs. Saying so costs the caller a 500 once; the alternative is a
 * workflow that looks like it works.
 */
export function checkResponseModeConfiguration(context: IWebhookFunctions): void {
	const responseMode = context.getNodeParameter('responseMode', 'responseNode') as string;
	const responseNodes = context
		.getChildNodes(context.getNode().name, { includeNodeParameters: true })
		.filter(isResponseNode);

	if (responseNodes.length === 0 && responseMode === 'responseNode') {
		throw new WorkflowConfigurationError(
			context.getNode(),
			new Error('No Servicely node set to "AI Agent Tool" found in the workflow'),
			{
				description:
					'Add a Servicely node with Resource "AI Agent Tool" and Operation "Send Response" to this workflow to answer the agent, or choose another option for the "Respond" parameter.',
			},
		);
	}

	if (responseNodes.length > 0 && responseMode !== 'responseNode') {
		throw new WorkflowConfigurationError(
			context.getNode(),
			new Error('Unused Servicely node set to "AI Agent Tool" found in the workflow'),
			{
				description:
					'Set the "Respond" parameter to "Using Servicely Node", or remove the Servicely node set to "AI Agent Tool".',
			},
		);
	}
}

/** The webhook description fields deciding how a call is answered. */
export const responseWebhookFields = {
	responseCode: `={{(${getResponseCode})($parameter)}}`,
	responseMode: '={{$parameter["responseMode"]}}',
	responseData: `={{(${getResponseData})($parameter)}}`,
	responseContentType: '={{$parameter["options"]["responseContentType"]}}',
	responsePropertyName: '={{$parameter["options"]["responsePropertyName"]}}',
	responseHeaders: '={{$parameter["options"]["responseHeaders"]}}',
};

/**
 * The trigger's Respond selector. The default is the responder, and not n8n's
 * `onReceived`: a tool exists to answer the agent with something it can use,
 * which is what that mode is for. It also has to stay put — n8n drops a
 * parameter left at its default when a workflow is saved, so moving the default
 * would silently move every workflow that never changed it.
 */
export const responseModeProperty: INodeProperties = {
	displayName: 'Respond',
	name: 'responseMode',
	type: 'options',
	noDataExpression: true,
	options: [
		{
			name: 'Immediately',
			value: 'onReceived',
			description: 'As soon as this node validated the request',
		},
		{
			name: 'When Last Node Finishes',
			value: 'lastNode',
			description: 'Returns data of the last-executed node',
		},
		{
			// The value is n8n's own, and what its webhook layer understands. Only the
			// label moved when the responder became a resource of the action node.
			name: 'Using Servicely Node',
			value: 'responseNode',
			description: 'Response defined by a Servicely node set to "AI Agent Tool"',
		},
	],
	default: 'responseNode',
	description: 'When and how to respond to the calling agent',
};

/** The notices telling each mode where its response actually comes from. */
export const responseModeNotices: INodeProperties[] = [
	{
		displayName:
			'Insert a Servicely node with Resource "AI Agent Tool" and Operation "Send Response" to control when and how you respond. The request stays open until that node runs, so a workflow that never reaches it never answers.',
		name: 'responseNodeNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { responseMode: ['responseNode'] } },
	},
	{
		displayName:
			'If you are sending back a response, add a "Content-Type" response header with the appropriate value to avoid unexpected behavior',
		name: 'contentTypeNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { responseMode: ['onReceived'] } },
	},
];

/** What the last node's data is turned into, for the mode that waits for it. */
export const responseDataProperty: INodeProperties = {
	displayName: 'Response Data',
	name: 'responseData',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { responseMode: ['lastNode'] } },
	options: [
		{
			name: 'All Entries',
			value: 'allEntries',
			description: 'Returns all the entries of the last node. Always returns an array.',
		},
		{
			name: 'First Entry JSON',
			value: 'firstEntryJson',
			description:
				'Returns the JSON data of the first entry of the last node. Always returns a JSON object.',
		},
		{
			name: 'No Response Body',
			value: 'noData',
			description: 'Returns without a body',
		},
	],
	default: 'firstEntryJson',
	description: 'What data should be returned',
};

/**
 * How long the service desk waits for this tool, exported with it as
 * `TimeoutSeconds` — the caller's patience, and the only deadline there is: n8n
 * holds the request open for as long as the workflow runs.
 *
 * Shown for the two modes that make the agent wait for the workflow, and not for
 * *Immediately*, which has answered before the workflow does anything. It is
 * still registered under that mode, since the tool record always carries a
 * timeout; it just has nothing to bound.
 *
 * The parameter keeps the name it had when it also armed a timer in n8n, so a
 * workflow saved with a timeout still registers the timeout it was given.
 */
export const toolTimeoutProperty: INodeProperties = {
	displayName: 'Tool Timeout (Seconds)',
	name: 'responseTimeout',
	type: 'number',
	noDataExpression: true,
	typeOptions: {
		minValue: 1,
		maxValue: 3600,
	},
	default: DEFAULT_RESPONSE_TIMEOUT_SECONDS,
	description:
		'How long the Servicely service desk waits for this tool to answer before it gives up on the call. Exported with the tool. n8n keeps the request open for as long as the workflow runs, so this bounds the agent\'s wait, not the workflow.',
	displayOptions: { show: { responseMode: ['lastNode', 'responseNode'] } },
};

/**
 * The entries the Respond modes add to the node's Options collection. Kept in
 * the order the collection is written in — alphabetical by title — so they can
 * be spliced in as they are.
 */
export const responseOptions: INodeProperties[] = [
	{
		displayName: 'No Response Body',
		name: 'noResponseBody',
		type: 'boolean',
		noDataExpression: true,
		default: false,
		description: 'Whether to send any body in the response',
		displayOptions: { show: { '/responseMode': ['onReceived'] } },
	},
	{
		displayName: 'Response Code',
		name: 'responseCode',
		type: 'number',
		noDataExpression: true,
		typeOptions: {
			minValue: 100,
			maxValue: 599,
		},
		default: 200,
		description: 'The HTTP status code to answer with',
		// The responder carries its own status code, so this would only
		// contradict it.
		displayOptions: { hide: { '/responseMode': ['responseNode'] } },
	},
	{
		displayName: 'Response Content-Type',
		name: 'responseContentType',
		type: 'string',
		noDataExpression: true,
		default: '',
		placeholder: 'e.g. application/xml',
		description:
			'Set a custom content-type to return if another one as the JSON default should be returned',
		displayOptions: {
			show: { '/responseMode': ['lastNode'], '/responseData': ['firstEntryJson'] },
		},
	},
	{
		displayName: 'Response Data',
		name: 'responseData',
		type: 'string',
		noDataExpression: true,
		default: '',
		placeholder: 'e.g. success',
		description: 'Custom response data to send instead of the default acknowledgement',
		displayOptions: {
			show: { '/responseMode': ['onReceived'] },
			hide: { noResponseBody: [true] },
		},
	},
	{
		displayName: 'Response Headers',
		name: 'responseHeaders',
		type: 'fixedCollection',
		noDataExpression: true,
		placeholder: 'Add Response Header',
		typeOptions: {
			multipleValues: true,
		},
		default: {},
		description: 'Headers to add to the response',
		displayOptions: { hide: { '/responseMode': ['responseNode'] } },
		options: [
			{
				name: 'entries',
				displayName: 'Entries',
				values: [
					{
						displayName: 'Name',
						name: 'name',
						type: 'string',
						noDataExpression: true,
						default: '',
						placeholder: 'e.g. X-Request-ID',
						description: 'Name of the header',
					},
					{
						displayName: 'Value',
						name: 'value',
						type: 'string',
						noDataExpression: true,
						default: '',
						description: 'Value of the header',
					},
				],
			},
		],
	},
	{
		displayName: 'Response Property Name',
		name: 'responsePropertyName',
		type: 'string',
		noDataExpression: true,
		default: 'data',
		description: 'Name of the property to return the data of instead of the whole JSON',
		displayOptions: {
			show: { '/responseMode': ['lastNode'], '/responseData': ['firstEntryJson'] },
		},
	},
];
