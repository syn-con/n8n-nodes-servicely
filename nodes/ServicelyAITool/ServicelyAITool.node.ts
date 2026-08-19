import {
	type IDataObject,
	type IExecuteFunctions,
	type IN8nHttpFullResponse,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	jsonParse,
	NodeConnectionTypes,
	NodeOperationError,
} from 'n8n-workflow';

import {
	DOCUMENTATION_URL,
	RESPONSE_DISPLAY_NAME,
	SEND_RESPONSE_ACTION,
	TOOL_CODEX,
	TOOL_DISPLAY_NAME,
	TOOL_NODE_TYPE,
} from './presentation';

type RespondWith = 'success' | 'error';
type SuccessData = 'allIncomingItems' | 'firstIncomingItem' | 'json' | 'noData';

interface ResponseHeaders {
	entries?: Array<{ name?: string; value?: string }>;
}

interface Options {
	envelope?: boolean;
	message?: string;
	responseHeaders?: ResponseHeaders;
}

/** Status codes that must not carry a body. */
const BODYLESS_STATUS_CODES = [204, 304];

/**
 * Answers the agent that called a Servicely AI Agent Tool. Pairs with the
 * {@link import('./ServicelyAIToolTrigger.node').ServicelyAIToolTrigger} trigger set to
 * "Using Servicely AI Agent Tool Response Node".
 */
export class ServicelyAITool implements INodeType {
	description: INodeTypeDescription = {
		// The card's name in the node creator, since the card is named after the node
		// that acts; on the canvas it is called `defaults.name` below.
		displayName: TOOL_DISPLAY_NAME,
		name: TOOL_NODE_TYPE,
		icon: { light: 'file:../../icons/servicely.svg', dark: 'file:../../icons/servicely.dark.svg' },
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["respondWith"] === "error" ? "Error" : "Success"}}',
		description: 'Respond to the agent that called the Servicely AI Agent Tool',
		documentationUrl: DOCUMENTATION_URL,
		// The same codex as the trigger, so the two are filed and found together
		codex: TOOL_CODEX,
		defaults: {
			name: RESPONSE_DISPLAY_NAME,
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		// This node only makes sense inside a workflow started by a tool call, not as a tool
		usableAsTool: undefined,
		properties: [
			// What the node creator lists under Actions, and what makes the trigger merge
			// into this node's card at all — an app with no actions is left alone. One
			// operation today; the selector is where a second one would go.
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Send Response',
						value: 'sendResponse',
						action: SEND_RESPONSE_ACTION,
						description: 'Answer the agent that called the tool',
					},
				],
				default: 'sendResponse',
			},
			{
				displayName:
					'The Servicely AI Agent Tool that starts this workflow must have "Respond" set to "Using Servicely AI Agent Tool Response Node" — it refuses a call otherwise, rather than leaving this node with an answer nobody is waiting for. n8n keeps the request open until this node runs, so a branch that never reaches it never answers, and the service desk stops waiting after the tool\'s Tool Timeout.',
				name: 'responseModeNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Respond With',
				name: 'respondWith',
				type: 'options',
				options: [
					{
						name: 'Error',
						value: 'error',
						description: 'Respond with an error status code and message',
					},
					{
						name: 'Success',
						value: 'success',
						description: 'Respond with a success status code and data',
					},
				],
				default: 'success',
				description: 'The kind of response to send back to the caller',
			},
			{
				displayName: 'Response Code',
				name: 'successResponseCode',
				type: 'number',
				typeOptions: {
					minValue: 100,
					maxValue: 599,
				},
				default: 200,
				description: 'The HTTP status code to respond with',
				displayOptions: { show: { respondWith: ['success'] } },
			},
			{
				displayName: 'Data',
				name: 'data',
				type: 'options',
				options: [
					{
						name: 'All Incoming Items',
						value: 'allIncomingItems',
						description: 'Respond with the JSON of all items reaching this node',
					},
					{
						name: 'First Incoming Item',
						value: 'firstIncomingItem',
						description: 'Respond with the JSON of the first item reaching this node',
					},
					{
						name: 'JSON',
						value: 'json',
						description: 'Respond with a JSON body you define below',
					},
					{
						name: 'No Data',
						value: 'noData',
						description: 'Respond without any data',
					},
				],
				default: 'firstIncomingItem',
				description: 'The data to send back to the caller',
				displayOptions: { show: { respondWith: ['success'] } },
			},
			{
				displayName: 'Response Body',
				name: 'responseBody',
				type: 'json',
				default: '{\n  "ok": true\n}',
				typeOptions: {
					rows: 4,
				},
				description: 'The JSON body to respond with',
				displayOptions: { show: { respondWith: ['success'], data: ['json'] } },
			},
			{
				displayName: 'Response Code',
				name: 'errorResponseCode',
				type: 'number',
				typeOptions: {
					minValue: 100,
					maxValue: 599,
				},
				default: 400,
				description: 'The HTTP status code to respond with',
				displayOptions: { show: { respondWith: ['error'] } },
			},
			{
				displayName: 'Error Message',
				name: 'errorMessage',
				type: 'string',
				default: 'Request failed',
				required: true,
				description: 'The message describing what went wrong',
				displayOptions: { show: { respondWith: ['error'] } },
			},
			{
				displayName: 'Error Details',
				name: 'errorDetails',
				type: 'json',
				default: '',
				typeOptions: {
					rows: 3,
				},
				placeholder: '{{ $json.validation.errors }}',
				description:
					'Optional machine readable details added to the error, e.g. the validation errors of the Servicely AI Agent Tool',
				displayOptions: { show: { respondWith: ['error'] } },
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Envelope',
						name: 'envelope',
						type: 'boolean',
						default: true,
						description:
							'Whether the response is wrapped in { "success": true, "data": ... } or { "success": false, "error": ... }. If turned off, the data or the error is sent as is.',
					},
					{
						displayName: 'Message',
						name: 'message',
						type: 'string',
						default: '',
						description: 'Message added to a success response',
						displayOptions: { show: { '/respondWith': ['success'] } },
					},
					{
						displayName: 'Response Headers',
						name: 'responseHeaders',
						type: 'fixedCollection',
						typeOptions: {
							multipleValues: true,
						},
						default: {},
						description: 'Headers to add to the response',
						options: [
							{
								name: 'entries',
								displayName: 'Header',
								values: [
									{
										displayName: 'Name',
										name: 'name',
										type: 'string',
										default: '',
										placeholder: 'e.g. X-Request-ID',
										description: 'Name of the header',
									},
									{
										displayName: 'Value',
										name: 'value',
										type: 'string',
										default: '',
										description: 'Value of the header',
									},
								],
							},
						],
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const respondWith = this.getNodeParameter('respondWith', 0) as RespondWith;
		const options = this.getNodeParameter('options', 0, {}) as Options;
		const envelope = options.envelope ?? true;

		let statusCode: number;
		let body: IDataObject | IDataObject[] | undefined;

		if (respondWith === 'error') {
			statusCode = this.getNodeParameter('errorResponseCode', 0) as number;
			const message = this.getNodeParameter('errorMessage', 0) as string;
			const details = parseOptionalJson(this, 'errorDetails');

			const error: IDataObject = { message };
			if (details !== undefined) {
				error.details = details;
			}
			body = envelope ? { success: false, error } : error;
		} else {
			statusCode = this.getNodeParameter('successResponseCode', 0) as number;
			const data = this.getNodeParameter('data', 0) as SuccessData;

			let payload: IDataObject | IDataObject[] | undefined;
			switch (data) {
				case 'allIncomingItems':
					payload = items.map((item) => item.json);
					break;
				case 'firstIncomingItem':
					payload = items[0]?.json ?? {};
					break;
				case 'json':
					payload = parseJsonParameter(this, 'responseBody');
					break;
				case 'noData':
					payload = undefined;
					break;
				// no default
			}

			if (envelope) {
				const envelopeBody: IDataObject = { success: true };
				if (options.message) {
					envelopeBody.message = options.message;
				}
				if (payload !== undefined) {
					envelopeBody.data = payload;
				}
				body = envelopeBody;
			} else {
				body = payload;
			}
		}

		const headers: IDataObject = {};
		for (const entry of options.responseHeaders?.entries ?? []) {
			const name = (entry.name ?? '').trim();
			if (!name) {
				continue;
			}
			headers[name.toLowerCase()] = entry.value ?? '';
		}
		if (body !== undefined && headers['content-type'] === undefined) {
			headers['content-type'] = 'application/json; charset=utf-8';
		}

		const response: IN8nHttpFullResponse = {
			body: BODYLESS_STATUS_CODES.includes(statusCode) ? undefined : body,
			headers,
			statusCode,
		};

		this.sendResponse(response);

		return [items];
	}
}

/** Reads a `json` typed parameter, accepting both a JSON string and an already resolved value. */
function parseJsonParameter(
	context: IExecuteFunctions,
	parameterName: string,
): IDataObject | IDataObject[] {
	const value = context.getNodeParameter(parameterName, 0) as unknown;

	if (typeof value !== 'string') {
		return value as IDataObject;
	}

	try {
		return jsonParse<IDataObject>(value);
	} catch {
		throw new NodeOperationError(
			context.getNode(),
			`The value in "${parameterName}" is not valid JSON`,
		);
	}
}

/** Same as {@link parseJsonParameter} but returns `undefined` for an empty parameter. */
function parseOptionalJson(
	context: IExecuteFunctions,
	parameterName: string,
): IDataObject | IDataObject[] | undefined {
	const value = context.getNodeParameter(parameterName, 0) as unknown;

	if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
		return undefined;
	}

	return parseJsonParameter(context, parameterName);
}
