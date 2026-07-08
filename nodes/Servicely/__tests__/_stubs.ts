import type { IExecuteFunctions, ILoadOptionsFunctions, IPollFunctions } from 'n8n-workflow';

import type { HttpRequestFn, HttpRequestSpec, RawHttpResponse } from '../types';

/** A single scripted HTTP outcome: a fixed response, or an error to throw. */
export type HttpStep =
  | { status: number; headers?: Record<string, string | string[]>; body?: unknown }
  | { throw: string };

export interface HttpStub {
  fn: HttpRequestFn;
  calls: HttpRequestSpec[];
  count: () => number;
}

/**
 * Build a programmable HttpRequestFn that yields queued steps in order (the last
 * step repeats once exhausted). Records every request spec for assertions.
 */
export function makeHttpStub(script: HttpStep[]): HttpStub {
  const calls: HttpRequestSpec[] = [];
  let n = 0;
  const fn: HttpRequestFn = async (spec) => {
    calls.push(spec);
    const step = script[Math.min(n, script.length - 1)];
    n += 1;
    if ('throw' in step) {
      throw new Error(step.throw);
    }
    return { statusCode: step.status, headers: step.headers ?? {}, body: step.body } as RawHttpResponse;
  };
  return { fn, calls, count: () => n };
}

/** A no-wait sleep that records the requested durations. */
export function makeSleepStub(): { fn: (ms: number) => Promise<void>; waits: number[] } {
  const waits: number[] = [];
  return {
    waits,
    fn: async (ms: number) => {
      waits.push(ms);
    },
  };
}

/** Nested params map keyed exactly as `getNodeParameter` names them (dot paths allowed). */
export type ParamMap = Record<string, unknown>;

export interface CtxOptions {
  params?: ParamMap;
  continueOnFail?: boolean;
  binary?: { fileName?: string; mimeType?: string; buffer?: Buffer };
}

/**
 * Minimal IExecuteFunctions stub for handler unit tests. `getNodeParameter`
 * reads from the provided map (falling back to the supplied default), and the
 * binary helpers echo the configured fixture.
 */
export function makeCtx(options: CtxOptions = {}): IExecuteFunctions {
  const params = options.params ?? {};
  const binary = options.binary ?? {};
  const ctx = {
    getNodeParameter: (name: string, _i: number, fallback?: unknown) =>
      name in params ? params[name] : fallback,
    continueOnFail: () => options.continueOnFail ?? false,
    getNode: () => ({ name: 'Servicely' }),
    helpers: {
      assertBinaryData: () => ({ fileName: binary.fileName, mimeType: binary.mimeType }),
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

/** n8n-helper-shaped HTTP response (returnFullResponse: true). */
type FullResponse = { statusCode: number; headers?: Record<string, string | string[]>; body?: unknown };

export interface LoadOptionsCtxOptions {
  params?: ParamMap;
  credentials?: Record<string, unknown>;
  http?: (opts: unknown) => Promise<FullResponse>;
}

/**
 * Minimal ILoadOptionsFunctions stub for listSearch/loadOptions unit tests.
 * `getNodeParameter(name, fallback?)` reads from the map; `helpers.httpRequest`
 * returns whatever the supplied `http` fn yields (default: empty list).
 */
export function makeLoadOptionsCtx(options: LoadOptionsCtxOptions = {}): ILoadOptionsFunctions {
  const params = options.params ?? {};
  const http = options.http ?? (async () => ({ statusCode: 200, headers: {}, body: { data: [] } }));
  const credentials = options.credentials ?? {
    instanceUrl: 'https://x.servicely.ai',
    authMethod: 'bearer',
    apiToken: 'token',
  };
  const ctx = {
    getNodeParameter: (name: string, fallback?: unknown) => (name in params ? params[name] : fallback),
    getCredentials: async () => credentials,
    getNode: () => ({ name: 'Servicely' }),
    logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
    helpers: { httpRequest: http },
  };
  return ctx as unknown as ILoadOptionsFunctions;
}

/**
 * Minimal IPollFunctions stub for trigger-handler unit tests. Its
 * `getNodeParameter(name, fallback?)` reads from the map (no itemIndex, like
 * the real poll context); credentials/http match the load-options stub.
 */
export function makePollCtx(options: LoadOptionsCtxOptions = {}): IPollFunctions {
  const params = options.params ?? {};
  const http = options.http ?? (async () => ({ statusCode: 200, headers: {}, body: { data: [] } }));
  const credentials = options.credentials ?? {
    instanceUrl: 'https://x.servicely.ai',
    authMethod: 'bearer',
    apiToken: 'token',
  };
  const ctx = {
    getNodeParameter: (name: string, fallback?: unknown) => (name in params ? params[name] : fallback),
    getCredentials: async () => credentials,
    getNode: () => ({ name: 'Servicely Trigger' }),
    helpers: { httpRequest: http },
  };
  return ctx as unknown as IPollFunctions;
}
