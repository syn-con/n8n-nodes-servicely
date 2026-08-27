import {
  type IDataObject,
  type IExecuteFunctions,
  type IN8nHttpFullResponse,
  type INodeExecutionData,
  type INodeProperties,
  jsonParse,
  NodeOperationError,
} from 'n8n-workflow';

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

/** Shown only for this resource, so the fields of the API operations stay untouched. */
const showForOperation = { resource: ['aiAgentTool'], operation: ['sendResponse'] };

export const description: INodeProperties[] = [
  {
    displayName:
      'The Servicely AI Agent Tool Trigger that starts this workflow must have "Respond" set to "Using Servicely Node" — it refuses a call otherwise, rather than leaving this operation with an answer nobody is waiting for. n8n keeps the request open until this node runs, so a branch that never reaches it never answers, and the service desk stops waiting after the trigger\'s Tool Timeout.',
    name: 'responseModeNotice',
    type: 'notice',
    default: '',
    displayOptions: { show: showForOperation },
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
    displayOptions: { show: showForOperation },
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
    displayOptions: { show: { ...showForOperation, respondWith: ['success'] } },
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
    displayOptions: { show: { ...showForOperation, respondWith: ['success'] } },
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
    displayOptions: {
      show: { ...showForOperation, respondWith: ['success'], data: ['json'] },
    },
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
    displayOptions: { show: { ...showForOperation, respondWith: ['error'] } },
  },
  {
    displayName: 'Error Message',
    name: 'errorMessage',
    type: 'string',
    default: 'Request failed',
    required: true,
    description: 'The message describing what went wrong',
    displayOptions: { show: { ...showForOperation, respondWith: ['error'] } },
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
      'Optional machine readable details added to the error, e.g. the validation errors of the Servicely AI Agent Tool Trigger',
    displayOptions: { show: { ...showForOperation, respondWith: ['error'] } },
  },
  {
    displayName: 'Options',
    name: 'options',
    type: 'collection',
    placeholder: 'Add option',
    default: {},
    displayOptions: { show: showForOperation },
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
];

/**
 * Answers the agent that called a Servicely AI Agent Tool, for a workflow started
 * by the Servicely AI Agent Tool Trigger set to "Using Servicely Node".
 *
 * One request gets one answer, but the router dispatches per item, so the response
 * is built from *all* the items reaching the node and sent on the first pass only.
 * Every pass returns its own item unchanged, which leaves the node's output the
 * items it was given — what a responder that ran once for the whole batch returned.
 */
export async function execute(
  this: IExecuteFunctions,
  index: number,
): Promise<INodeExecutionData[]> {
  const items = this.getInputData();

  if (index === 0) {
    this.sendResponse(buildResponse.call(this, items));
  }

  return [{ json: items[index]?.json ?? {}, pairedItem: { item: index } }];
}

/** The whole HTTP answer, decided from the parameters and the batch reaching the node. */
function buildResponse(
  this: IExecuteFunctions,
  items: INodeExecutionData[],
): IN8nHttpFullResponse {
  const respondWith = this.getNodeParameter('respondWith', 0) as RespondWith;
  const options = this.getNodeParameter('options', 0, {}) as Options;

  const statusCode = this.getNodeParameter(
    respondWith === 'error' ? 'errorResponseCode' : 'successResponseCode',
    0,
  ) as number;
  const body =
    respondWith === 'error' ? buildErrorBody.call(this, options) : buildSuccessBody.call(this, items, options);

  const headers = buildHeaders(options);
  if (body !== undefined && headers['content-type'] === undefined) {
    headers['content-type'] = 'application/json; charset=utf-8';
  }

  return {
    body: BODYLESS_STATUS_CODES.includes(statusCode) ? undefined : body,
    headers,
    statusCode,
  };
}

/** The message, and whatever machine readable details came with it. */
function buildErrorBody(this: IExecuteFunctions, options: Options): IDataObject {
  const error: IDataObject = { message: this.getNodeParameter('errorMessage', 0) as string };
  const details = parseOptionalJson(this, 'errorDetails');
  if (details !== undefined) {
    error.details = details;
  }

  return (options.envelope ?? true) ? { success: false, error } : error;
}

/** The data the node was told to answer with, enveloped unless that was turned off. */
function buildSuccessBody(
  this: IExecuteFunctions,
  items: INodeExecutionData[],
  options: Options,
): IDataObject | IDataObject[] | undefined {
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

  if (!(options.envelope ?? true)) {
    return payload;
  }

  const body: IDataObject = { success: true };
  if (options.message) {
    body.message = options.message;
  }
  if (payload !== undefined) {
    body.data = payload;
  }
  return body;
}

/** The configured headers, lowercased, skipping the rows left without a name. */
function buildHeaders(options: Options): IDataObject {
  const headers: IDataObject = {};

  for (const entry of options.responseHeaders?.entries ?? []) {
    const name = (entry.name ?? '').trim();
    if (!name) {
      continue;
    }
    headers[name.toLowerCase()] = entry.value ?? '';
  }

  return headers;
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
