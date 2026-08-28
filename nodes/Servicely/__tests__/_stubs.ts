import type {
  IBinaryData,
  IExecuteFunctions,
  IHttpRequestOptions,
  ILoadOptionsFunctions,
  INode,
  INodeExecutionData,
  IPollFunctions,
} from 'n8n-workflow';

/** A single scripted HTTP outcome: a full response, or an error to throw. */
export type HttpStep =
  | { status: number; headers?: Record<string, string | string[]>; body?: unknown }
  | { throw: string };

export interface HttpCall {
  credentialsType: string;
  options: IHttpRequestOptions;
}

export interface HttpStub {
  fn: (credentialsType: string, options: IHttpRequestOptions) => Promise<unknown>;
  calls: HttpCall[];
  count: () => number;
}

/**
 * Build a programmable `httpRequestWithAuthentication` that yields queued steps
 * in order (the last step repeats once exhausted), recording every call.
 */
export function makeHttpStub(script: HttpStep[]): HttpStub {
  const calls: HttpCall[] = [];
  let n = 0;
  const fn = async (credentialsType: string, options: IHttpRequestOptions) => {
    calls.push({ credentialsType, options });
    const step = script[Math.min(n, script.length - 1)];
    n += 1;
    if ('throw' in step) {
      throw new Error(step.throw);
    }
    return { statusCode: step.status, headers: step.headers ?? {}, body: step.body };
  };
  return { fn, calls, count: () => n };
}

/**
 * Build a `httpRequestWithAuthentication` that answers from the request itself
 * (its path and `page`) rather than from a queue. Paging tests need this: pages
 * of concurrent requests do not arrive in a predictable order, so a positional
 * script cannot say which page a given response belongs to.
 */
export function makeRoutedHttpStub(route: (url: string, page: number) => HttpStep): HttpStub {
  const calls: HttpCall[] = [];
  let n = 0;
  const fn = async (credentialsType: string, options: IHttpRequestOptions) => {
    calls.push({ credentialsType, options });
    n += 1;
    const step = route(String(options.url), Number((options.qs as { page?: unknown })?.page ?? 1));
    if ('throw' in step) {
      throw new Error(step.throw);
    }
    return { statusCode: step.status, headers: step.headers ?? {}, body: step.body };
  };
  return { fn, calls, count: () => n };
}

/** A 200 response carrying Servicely's `{ data }` envelope. */
export function ok(data: unknown): HttpStep {
  return { status: 200, body: { data } };
}

const NODE: INode = {
  id: 'n1',
  name: 'Servicely',
  type: 'servicely',
  typeVersion: 1,
  position: [0, 0],
  parameters: {},
};

/** Nested params map keyed exactly as `getNodeParameter` names them (dot paths allowed). */
export type ParamMap = Record<string, unknown>;

export interface ExecuteCtxOptions {
  params?: ParamMap;
  items?: INodeExecutionData[];
  continueOnFail?: boolean;
  http?: HttpStub;
  binary?: { fileName?: string; mimeType?: string; buffer?: Buffer };
}

/**
 * Minimal IExecuteFunctions stub. `getNodeParameter(name, itemIndex, fallback)`
 * reads from the map, and the binary helpers echo the configured fixture.
 * `getInputData` is present, which is how GenericFunctions tells an execute
 * context apart from a poll/load-options one.
 */
export function makeExecuteCtx(options: ExecuteCtxOptions = {}): IExecuteFunctions {
  const params = options.params ?? {};
  const binary = options.binary ?? {};
  const ctx = {
    getInputData: () => options.items ?? [{ json: {} }],
    getNodeParameter: (name: string, _i: number, fallback?: unknown) => (name in params ? params[name] : fallback),
    continueOnFail: () => options.continueOnFail ?? false,
    getNode: () => NODE,
    // A real execution context has one, and an operation that logs must not take
    // the run down with it
    logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
    helpers: {
      httpRequestWithAuthentication: options.http?.fn ?? makeHttpStub([ok([])]).fn,
      assertBinaryData: () => ({ fileName: binary.fileName, mimeType: binary.mimeType }) as IBinaryData,
      getBinaryDataBuffer: async () => binary.buffer ?? Buffer.from(''),
      prepareBinaryData: async (buffer: Buffer, fileName?: string, mimeType?: string) => ({
        data: buffer.toString('base64'),
        fileName,
        mimeType,
      }),
    },
  };
  return ctx as unknown as IExecuteFunctions;
}

export interface PollCtxOptions {
  params?: ParamMap;
  http?: HttpStub;
}

/**
 * Minimal IPollFunctions / ILoadOptionsFunctions stub. Their
 * `getNodeParameter(name, fallback?)` takes no item index, and neither context
 * exposes `getInputData`.
 *
 * `getCurrentNodeParameter` reads the same map: what a resourceMapper's schema
 * loader sees mid-edit is the parameter as it stands in the UI, and a test
 * scripting that map is scripting exactly that.
 */
function makeIndexlessCtx(options: PollCtxOptions = {}) {
  const params = options.params ?? {};
  return {
    getNodeParameter: (name: string, fallback?: unknown) => (name in params ? params[name] : fallback),
    getCurrentNodeParameter: (name: string) => params[name],
    getNode: () => NODE,
    logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
    helpers: { httpRequestWithAuthentication: options.http?.fn ?? makeHttpStub([ok([])]).fn },
  };
}

export function makePollCtx(options: PollCtxOptions = {}): IPollFunctions {
  return makeIndexlessCtx(options) as unknown as IPollFunctions;
}

export function makeLoadOptionsCtx(options: PollCtxOptions = {}): ILoadOptionsFunctions {
  return makeIndexlessCtx(options) as unknown as ILoadOptionsFunctions;
}
