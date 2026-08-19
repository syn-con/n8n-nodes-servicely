import {
	type IDataObject,
	type INodeType,
	type INodeTypeDescription,
	type IWebhookFunctions,
	type IWebhookResponseData,
	NodeConnectionTypes,
} from 'n8n-workflow';

import { getAiAgents, getAiAssistants, getRoles } from '../Servicely/SearchFunctions';
import {
	type AuthenticationResult,
	AUTH_CREDENTIAL_NAME,
	authenticateRequest,
	WebhookAuthorizationError,
} from './authentication';
import { DEFAULT_EXECUTION_SCRIPT, readParameterDefinitions } from './parameters';
import {
	AUTH_DISPLAY_NAME,
	DOCUMENTATION_URL,
	TOOL_CODEX,
	TOOL_DISPLAY_NAME,
	TRIGGER_DISPLAY_NAME,
	TRIGGER_NODE_TYPE,
} from './presentation';
import { toolRegistrationMethods } from './registration';
import {
	checkResponseModeConfiguration,
	responseDataProperty,
	responseModeNotices,
	responseModeProperty,
	responseOptions,
	responseWebhookFields,
	toolTimeoutProperty,
} from './response';
import { isPlainObject, validateBody } from './validation';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

/**
 * Exposes a workflow as a tool a Servicely service desk agent can call. The node
 * declares the tool (name, prompt and typed parameters), serves it on an HTTP POST
 * endpoint and validates the request body against those parameters before the
 * workflow starts.
 */
export class ServicelyAIToolTrigger implements INodeType {
	description: INodeTypeDescription = {
		// Says "Trigger" because that is how the node creator recognises one; the node
		// it drops is still called `defaults.name` below, which is what registers.
		displayName: TRIGGER_DISPLAY_NAME,
		name: TRIGGER_NODE_TYPE,
		icon: { light: 'file:../../icons/servicely.svg', dark: 'file:../../icons/servicely.dark.svg' },
		group: ['trigger'],
		version: 1,
		// The tool is named after the node, so the canvas already says which tool this
		// is; the subtitle says where it answers instead
		subtitle: '={{"POST /" + $parameter["path"]}}',
		description: 'Expose this workflow as a tool for the Servicely service desk AI agent',
		documentationUrl: DOCUMENTATION_URL,
		// Filed and found alongside its Response node — see `presentation.ts`
		codex: TOOL_CODEX,
		eventTriggerDescription: 'Waiting for the agent to call the tool',
		activationMessage: 'The tool can now be called on your production URL.',
		defaults: {
			name: TOOL_DISPLAY_NAME,
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
				'displayName': AUTH_DISPLAY_NAME,
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
				// How the call is answered, declared rather than written by this node —
				// see `response.ts`
				...responseWebhookFields,
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
					'The attached Servicely AI Agent Tool Auth credential decides what a caller has to present: Basic, Header or JWT authentication.',
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
					'The arguments of the tool. They are exported with it and every request is validated against them: a required argument has to be sent, and any argument that is sent has to have the declared type. A boolean IsLiveRun is always exported on top of these — the agent sends true unless it was asked for a test run — but it is not validated, so a call that omits it still runs. Declaring one here replaces it, and then it is validated like any other.',
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
								// n8n drops a fixedCollection value that equals its default when the
								// workflow is saved, so a row left on String carries no type at all —
								// which the reader turns back into String, and the tool is registered
								// with the same type either way.
								default: 'string',
								description: 'The type the value must have. Defaults to String.',
							},
							{
								displayName: 'Param Required',
								name: 'paramRequired',
								type: 'boolean',
								noDataExpression: true,
								// Ticked by default, so a parameter declared before this box existed —
								// where every one of them had to be sent — keeps being validated the
								// same way. n8n drops the field from the saved workflow while it is
								// ticked, which is why an absent value reads as required.
								default: true,
								description:
									'Whether a call has to send this argument. Turn it off and a call that leaves it out still runs; one that does send it still has to send the declared type. This is checked here only — the tool is exported with the argument either way.',
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
			responseModeProperty,
			...responseModeNotices,
			responseDataProperty,
			toolTimeoutProperty,
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
						displayName: 'AI Agent Names or IDs',
						name: 'aiAgents',
						type: 'multiOptions',
						noDataExpression: true,
						typeOptions: {
							loadOptionsMethod: 'getAiAgents',
						},
						default: [],
						description:
							'The Servicely AI agents this tool is exported to. The list shows SystemAIAgent records by Name; each agent is stored by its record ID. Activating the workflow adds the tool to those agents\' Tools, and takes it out of the agents you deselect — so leaving this out unlinks the tool from every agent. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
					},
					{
						displayName: 'AI Assistant Names or IDs',
						name: 'aiAssistants',
						type: 'multiOptions',
						noDataExpression: true,
						typeOptions: {
							loadOptionsMethod: 'getAiAssistants',
						},
						default: [],
						description:
							'The Servicely AI assistants this tool is exported to, the same way as the agents above: SystemAIAssistant records by Name, stored by record ID, and reconciled against their Tools on activation. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
					},
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
							'Script the service desk runs when the agent calls this tool. Exported with it. Add this option only to replace the default script, which posts the call\'s parameters to this workflow and answers with what it returns. Every "@@WEBHOOK_URL@@" is replaced with this tool\'s webhook URL when the workflow is activated, so the script does not have to be edited when it moves between instances — quoted for you, unless you quoted the placeholder yourself.',
					},
					{
						displayName: 'Mutates Ticket',
						name: 'mutatesTicket',
						type: 'boolean',
						noDataExpression: true,
						default: false,
						description:
							'Whether calling this tool changes something. Turn it on for tools that create, update or delete records, send messages, trigger external automations, or otherwise cause side effects. Exported with the tool; leave the option out and the service desk keeps whatever the tool already says.',
					},
					{
						displayName: 'Production Restricted',
						name: 'productionRestricted',
						type: 'boolean',
						noDataExpression: true,
						default: false,
						description:
							'Whether the tool is kept out of production environments. When on, it cannot be selected, executed or modified on a production system — for keeping an AI from, say, changing the schema of a live instance. Exported with the tool; leave the option out and the service desk keeps whatever the tool already says.',
					},
					{
						displayName: 'Role Names or IDs',
						name: 'roles',
						type: 'multiOptions',
						noDataExpression: true,
						typeOptions: {
							loadOptionsMethod: 'getRoles',
						},
						default: [],
						description:
							'The Servicely roles this tool is given. The list shows Role records by Name; each role is stored by its record ID, in the tool\'s own Roles. Activating the workflow writes the selection as it stands — so adding this option and selecting nothing empties the tool\'s roles, while leaving the option out keeps whatever the service desk holds. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
					},
					// Everything the answer to a call is made of, for the modes that leave
					// it to n8n rather than to a response node
					...responseOptions,
				],
			},
		],
	};



	/** Only the registries this node selects from: the pickers of the Servicely node have no counterpart here. */
	methods = { loadOptions: { getAiAgents, getAiAssistants, getRoles } };

	/** Registers the tool in the service desk on activation, removes it on deactivation. */
	webhookMethods = toolRegistrationMethods;

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		// Before anything is let in: a Respond setting the workflow cannot honour is a
		// call that would never be answered, and saying so beats hanging.
		checkResponseModeConfiguration(this);

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
			// The body of the "Immediately" mode, and only when the node was not told
			// something more specific: the Response Data option overrides it, and No
			// Response Body drops it. The other modes answer from the workflow, so n8n
			// ignores it there.
			webhookResponse: { success: true, message: 'Workflow was started' },
			workflowData: [[{ json }]],
		};
	}
}

