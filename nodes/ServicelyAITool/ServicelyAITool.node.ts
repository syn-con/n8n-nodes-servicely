import {
	type IDataObject,
	type INodeType,
	type INodeTypeDescription,
	type IWebhookFunctions,
	type IWebhookResponseData,
	NodeConnectionTypes,
} from 'n8n-workflow';

import { getAiAgents } from '../Servicely/SearchFunctions';
import {
	type AuthenticationResult,
	AUTH_CREDENTIAL_NAME,
	authenticateRequest,
	WebhookAuthorizationError,
} from './authentication';
import {
	DEFAULT_EXECUTION_SCRIPT,
	DEFAULT_RESPONSE_TIMEOUT_SECONDS,
	readParameterDefinitions,
	readResponseTimeoutSeconds,
} from './parameters';
import { toolRegistrationMethods } from './registration';
import { isPlainObject, validateBody } from './validation';

/** The still open HTTP response of the request that started the workflow. */
type WebhookResponse = ReturnType<IWebhookFunctions['getResponseObject']>;

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

/**
 * Exposes a workflow as a tool a Servicely service desk agent can call. The node
 * declares the tool (name, prompt and typed parameters), serves it on an HTTP POST
 * endpoint and validates the request body against those parameters before the
 * workflow starts.
 */
export class ServicelyAITool implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Servicely AI Tool',
		name: 'servicelyAiTool',
		icon: { light: 'file:../../icons/servicely.svg', dark: 'file:../../icons/servicely.dark.svg' },
		group: ['trigger'],
		version: 1,
		// The tool is named after the workflow, so the path is what identifies this node
		subtitle: '={{"POST /" + $parameter["path"]}}',
		description: 'Expose this workflow as a tool for the Servicely service desk agent',
		documentationUrl: 'https://docs-servicely.atlassian.net/wiki/spaces/SD/pages/2077523978',
		eventTriggerDescription: 'Waiting for the agent to call the tool',
		activationMessage: 'The tool can now be called on your production URL.',
		defaults: {
			name: 'Servicely AI Tool',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		// This node defines a tool, it is not itself callable by an n8n agent
		usableAsTool: undefined,
		credentials: [
			{
				// Reads the instance's agents for the AI Agents selector
				name: 'servicelyApi',
				'displayName': 'Servicely API',
				required: true,
			},
			{
				// Decides what a caller has to present; the endpoint is never public
				name: AUTH_CREDENTIAL_NAME,
				'displayName': 'Servicely AI Tool Auth',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				// Serve exactly the configured path instead of prefixing the internal webhook ID
				isFullPath: true,
				path: '={{$parameter["path"]}}',
				responseMode: '={{$parameter["responseMode"]}}',
				// "lastNode" answers with the first item of the last node. For the other modes this
				// has to stay empty, otherwise n8n sends the response data type itself as the body.
				responseData: '={{$parameter["responseMode"] === "lastNode" ? "firstEntryJson" : ""}}',
			},
		],
		// `noDataExpression` on every field, deliberately. This node defines a tool
		// rather than processing items: it has no input, so there is no `$json` to
		// reference, and its values are read on activation — when no execution is
		// running to resolve an expression against. A field that cannot be expressed
		// says so in the UI instead of resolving to nothing at registration time.
		properties: [
			{
				displayName:
					'The attached Servicely AI Tool Auth credential decides what a caller has to present: Basic, Header or JWT authentication.',
				name: 'authenticationNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Prompt',
				name: 'prompt',
				type: 'string',
				noDataExpression: true,
				typeOptions: {
					rows: 3,
				},
				default: '',
				placeholder: 'e.g. Creates an incident for a user and returns its number',
				required: true,
				description:
					'Tells the agent what this tool does and when to call it. Exported with the tool.',
			},
			{
				displayName: 'AI Agents',
				name: 'aiAgents',
				type: 'multiOptions',
				noDataExpression: true,
				typeOptions: {
					loadOptionsMethod: 'getAiAgents',
				},
				default: [],
				description:
					'The Servicely AI agents this tool is exported to. The list shows SystemAIAgent records by Name; each agent is stored by its record ID. Activating the workflow adds the tool to those agents\' Tools, and takes it out of the agents you deselect.',
			},
			{
				displayName: 'Path',
				name: 'path',
				type: 'string',
				noDataExpression: true,
				default: '',
				placeholder: 'e.g. create-incident',
				required: true,
				description: 'The path this tool listens on, appended to the webhook base URL',
			},
			{
				displayName: 'Parameters',
				name: 'parameters',
				placeholder: 'Add Parameter',
				type: 'fixedCollection',
				noDataExpression: true,
				typeOptions: {
					multipleValues: true,
					sortable: true,
				},
				default: {},
				description:
					'The arguments of the tool. They are exported with it and every request is validated against them. A boolean IsProduction is always exported on top of these — the agent sends true unless it was asked for a test run — but it is not validated, so a call that omits it still runs. Declaring one here replaces it, and then it is validated like any other.',
				options: [
					{
						name: 'values',
						displayName: 'Parameter',
						values: [
							{
								displayName: 'Param Name',
								name: 'paramName',
								type: 'string',
								noDataExpression: true,
								default: '',
								placeholder: 'e.g. customerId',
								description: 'Name of the argument, as the agent has to send it',
								required: true,
							},
							{
								displayName: 'Param Type',
								name: 'paramType',
								type: 'options',
								noDataExpression: true,
								options: [
									{
										name: 'Boolean',
										value: 'boolean',
									},
									{
										name: 'Integer',
										value: 'integer',
									},
									{
										name: 'Number',
										value: 'number',
									},
									{
										name: 'String',
										value: 'string',
									},
								],
								// The empty default is deliberate. n8n drops parameter values that equal
								// their default when a workflow is saved, so a default that cannot be
								// picked is what keeps paramType in the exported JSON — the tool
								// definition then survives an import on another instance.
								default: '',
								description: 'The type the value must have. Defaults to String.',
							},
							{
								displayName: 'Param Description',
								name: 'paramDescription',
								type: 'string',
								noDataExpression: true,
								default: '',
								placeholder: 'e.g. ID of the customer the incident is raised for',
								description: 'What this argument means. Exported with the tool.',
							},
						],
					},
				],
			},
			{
				displayName: 'Respond',
				name: 'responseMode',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Using Servicely AI Tool Response Node',
						value: 'responseNode',
						description:
							'Respond from a Servicely AI Tool Response node further down the workflow',
					},
					{
						name: 'Immediately',
						value: 'onReceived',
						description: 'Respond as soon as this node validated the request',
					},
					{
						name: 'When Last Node Finishes',
						value: 'lastNode',
						description: 'Respond with the data of the last executed node',
					},
				],
				default: 'responseNode',
				description: 'When and how to respond to the calling agent',
			},
			// Both waiting modes bound the same value, but they wait for different things,
			// so each states what it waits for. Two properties under one name is how a
			// title can differ per mode: the displayOptions are disjoint, so only ever
			// one of them is shown, and both read and write `responseTimeout`.
			{
				displayName: 'Response Node Timeout (Seconds)',
				name: 'responseTimeout',
				type: 'number',
				noDataExpression: true,
				typeOptions: {
					minValue: 1,
					maxValue: 3600,
				},
				default: DEFAULT_RESPONSE_TIMEOUT_SECONDS,
				description:
					'How long to wait for the Servicely AI Tool Response node. When it does not respond in time the caller gets a 504, while the workflow keeps running.',
				displayOptions: { show: { responseMode: ['responseNode'] } },
			},
			{
				displayName: 'Workflow Timeout (Seconds)',
				name: 'responseTimeout',
				type: 'number',
				noDataExpression: true,
				typeOptions: {
					minValue: 1,
					maxValue: 3600,
				},
				default: DEFAULT_RESPONSE_TIMEOUT_SECONDS,
				description:
					'How long to wait for the last node to finish. When the workflow does not finish in time the caller gets a 504, while the workflow keeps running.',
				displayOptions: { show: { responseMode: ['lastNode'] } },
			},
			{
				displayName: 'On Validation Error',
				name: 'onValidationError',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Respond 400 Bad Request',
						value: 'respondError',
						description: 'Reject the request with the validation errors, the workflow does not run',
					},
					{
						name: 'Run Workflow Anyway',
						value: 'continue',
						description:
							'Run the workflow and pass the validation errors on in the "validation" property',
					},
				],
				default: 'respondError',
				description: 'What to do when the request body does not match the parameters',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				noDataExpression: true,
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Allow Unknown Parameters',
						name: 'allowUnknownParameters',
						type: 'boolean',
						noDataExpression: true,
						default: true,
						description:
							'Whether body properties that are not defined above are accepted. If turned off, they are reported as validation errors.',
					},
					{
						displayName: 'Coerce Types',
						name: 'coerceTypes',
						type: 'boolean',
						noDataExpression: true,
						default: false,
						description:
							'Whether values are converted to the defined type before validation, e.g. the string "12" to the number 12. Useful for form encoded bodies.',
					},
					{
						displayName: 'Execution Script',
						name: 'executionScript',
						type: 'string',
						noDataExpression: true,
						typeOptions: {
							rows: 12,
							editor: 'jsEditor',
							editorLanguage: 'javaScript',
						},
						default: DEFAULT_EXECUTION_SCRIPT,
						description:
							'Script the service desk runs when the agent calls this tool. Exported with it. Add this option only to replace the default script, which posts the call\'s parameters to this workflow and answers with what it returns. Every "@@URL@@" is replaced with this tool\'s webhook URL when the workflow is activated, so the script does not have to be edited when it moves between instances — quoted for you, unless you quoted the placeholder yourself.',
					},
				],
			},
		],
	};



	/** Only the agent loader: the pickers of the Servicely node have no counterpart here. */
	methods = { loadOptions: { getAiAgents } };

	/** Registers the tool in the service desk on activation, removes it on deactivation. */
	webhookMethods = toolRegistrationMethods;

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const onValidationError = this.getNodeParameter('onValidationError') as
			| 'respondError'
			| 'continue';
		const options = this.getNodeParameter('options', {}) as {
			allowUnknownParameters?: boolean;
			coerceTypes?: boolean;
		};

		const response = this.getResponseObject();

		let authentication: AuthenticationResult | undefined;
		try {
			authentication = await authenticateRequest(this);
		} catch (error) {
			if (error instanceof WebhookAuthorizationError) {
				response.writeHead(error.responseCode, { ...JSON_HEADERS, ...error.headers });
				response.end(JSON.stringify({ success: false, error: { message: error.message } }));
				return { noWebhookResponse: true };
			}
			throw error;
		}

		const definitions = readParameterDefinitions(this);
		const body = this.getBodyData();

		const result = isPlainObject(body)
			? validateBody(body, definitions, {
				allowUnknownParameters: options.allowUnknownParameters ?? true,
				coerceTypes: options.coerceTypes ?? false,
			})
			: {
				valid: false,
				errors: [{ key: '', message: 'The request body must be a JSON object' }],
				parameters: {},
			};

		if (!result.valid && onValidationError === 'respondError') {
			response.writeHead(400, JSON_HEADERS);
			response.end(
				JSON.stringify({
					success: false,
					error: { message: 'Request body validation failed', details: result.errors },
				}),
			);
			return { noWebhookResponse: true };
		}

		// Both waiting modes can leave the caller hanging: the response node answers
		// whenever the workflow reaches it, which may be never, and the last node
		// finishes whenever the workflow does. The timer bounds either wait. The
		// "Immediately" mode has answered by the time this returns, so it needs none.
		const responseMode = this.getNodeParameter('responseMode') as string;
		if (responseMode === 'responseNode' || responseMode === 'lastNode') {
			scheduleResponseTimeout(response, readResponseTimeoutSeconds(this));
		}

		const json: IDataObject = {
			body,
			parameters: result.parameters,
			headers: this.getHeaderData(),
			query: this.getQueryData(),
			params: this.getParamsData(),
			validation: { valid: result.valid, errors: result.errors },
		};
		if (authentication?.jwtPayload !== undefined) {
			json.jwt = authentication.jwtPayload;
		}

		return {
			// Only used by the "Immediately" response mode, the other modes answer later
			webhookResponse: { success: true, message: 'Workflow was started' },
			workflowData: [[{ json }]],
		};
	}
}

/**
 * Answers the still open request with 504 when nothing responded within `seconds`.
 * The workflow itself is left running; only the caller stops waiting.
 */
function scheduleResponseTimeout(response: WebhookResponse, seconds: number): void {
	if (!Number.isFinite(seconds) || seconds <= 0) {
		return;
	}

	const timer = setTimeout(() => {
		if (response.headersSent || response.writableEnded) {
			return;
		}
		response.writeHead(504, JSON_HEADERS);
		response.end(
			JSON.stringify({
				success: false,
				error: { message: `The workflow did not respond within ${seconds} seconds` },
			}),
		);
	}, seconds * 1000);

	// A pending timer must not hold the process open, and it is pointless once the
	// response node (or a client disconnect) has closed the request.
	timer.unref?.();
	response.on('close', () => clearTimeout(timer));
}

