import { describe, expect, it, vi } from 'vitest';

import { nodeMethods } from '../methods';
import {
  searchActions,
  searchAttachments,
  searchObjectRecords,
  searchParentRecords,
  searchQueues,
  searchTables,
} from '../methods/listSearch';
import { makeLoadOptionsCtx } from './_stubs';

/** An httpRequest stub that returns a fixed list envelope. */
function listHttp(records: Array<Record<string, unknown>>) {
  return vi.fn(async () => ({ statusCode: 200, headers: {}, body: { data: records } }));
}

/** Read the request URL off an opaque httpRequest options object. */
function reqUrl(opts: unknown): string {
  return String((opts as { url?: string }).url ?? '');
}

describe('nodeMethods', () => {
  it('registers the listSearch methods used by the resourceLocators', () => {
    expect(Object.keys(nodeMethods.listSearch)).toEqual([
      'searchTables',
      'searchObjectRecords',
      'searchParentRecords',
      'searchAttachments',
      'searchQueues',
      'searchActions',
    ]);
  });
});

describe('listSearch — searchTables', () => {
  // A uniform http stub: /_batch returns a non-registry body (so the probe finds
  // nothing), while cmdbmetadata/availablevalue GETs return a name row. Discovery
  // therefore yields exactly the one dynamic table.
  it('returns tables discovered dynamically from the instance', async () => {
    const http = listHttp([{ name: 'Incident' }]);
    const res = await searchTables.call(makeLoadOptionsCtx({ http }));
    expect(res.results).toEqual([{ name: 'Incident', value: 'Incident' }]);
  });

  it('filters the discovered tables case-insensitively', async () => {
    const http = listHttp([{ name: 'Incident' }]);
    const included = await searchTables.call(makeLoadOptionsCtx({ http }), 'inc');
    expect(included.results).toEqual([{ name: 'Incident', value: 'Incident' }]);
    const excluded = await searchTables.call(makeLoadOptionsCtx({ http }), 'zzz');
    expect(excluded.results).toEqual([]);
  });
});

describe('listSearch — record pickers', () => {
  it('searches the selected object table and labels records', async () => {
    const http = listHttp([
      { id: 'a1', Number: 'INC1' },
      { id: 'b2', ShortDescription: 'Printer' },
      { id: 'c3' },
    ]);
    const ctx = makeLoadOptionsCtx({ params: { tableName: 'Incident' }, http });
    const res = await searchObjectRecords.call(ctx);
    expect(res.results).toEqual([
      { name: 'INC1 (a1)', value: 'a1' },
      { name: 'Printer (b2)', value: 'b2' },
      { name: 'c3', value: 'c3' },
    ]);
    expect(http).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('/v1/Incident') }));
  });

  it('returns nothing when no table is selected', async () => {
    const res = await searchObjectRecords.call(makeLoadOptionsCtx({ params: {} }));
    expect(res.results).toEqual([]);
  });

  it('filters fetched parent records client-side by the term', async () => {
    const http = listHttp([
      { id: 'a1', Number: 'INC1' },
      { id: 'b2', Number: 'INC2' },
    ]);
    const ctx = makeLoadOptionsCtx({ params: { parentTable: 'Incident' }, http });
    const res = await searchParentRecords.call(ctx, 'inc2');
    expect(res.results).toEqual([{ name: 'INC2 (b2)', value: 'b2' }]);
  });

  it('searchAttachments queries the Attachment table', async () => {
    const http = listHttp([{ id: 'x', FileName: 'a.png' }]);
    const res = await searchAttachments.call(makeLoadOptionsCtx({ http }));
    expect(res.results).toEqual([{ name: 'a.png (x)', value: 'x' }]);
    expect(http).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('/v1/Attachment') }));
  });

  it('uses a displayValue object for the label when present', async () => {
    const http = listHttp([{ id: 'r1', Name: { value: 'v', displayValue: 'Nice Name' } }]);
    const ctx = makeLoadOptionsCtx({ params: { tableName: 'User' }, http });
    const res = await searchObjectRecords.call(ctx);
    expect(res.results).toEqual([{ name: 'Nice Name (r1)', value: 'r1' }]);
  });
});

describe('listSearch — searchQueues', () => {
  it('lists async_integration provider instances keyed by ConnectionString', async () => {
    const http = listHttp([
      { id: 'pi1', Name: 'Prod', ConnectionString: 'conn-prod' },
      { id: 'pi2', ConnectionString: 'conn-bare' },
      { id: 'pi3' }, // no ConnectionString → skipped
    ]);
    const res = await searchQueues.call(makeLoadOptionsCtx({ http }));
    expect(res.results).toEqual([
      { name: 'Prod (conn-prod)', value: 'conn-prod' },
      { name: 'conn-bare', value: 'conn-bare' },
    ]);
    expect(http).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringContaining('/v1/ActionProviderInstance') }),
    );
  });

  it('filters the queue list client-side', async () => {
    const http = listHttp([
      { id: 'pi1', Name: 'Prod', ConnectionString: 'conn-prod' },
      { id: 'pi2', Name: 'Dev', ConnectionString: 'conn-dev' },
    ]);
    const res = await searchQueues.call(makeLoadOptionsCtx({ http }), 'dev');
    expect(res.results).toEqual([{ name: 'Dev (conn-dev)', value: 'conn-dev' }]);
  });
});

describe('listSearch — searchActions', () => {
  /** Two-step stub: ActionProviderInstance lookup, then the Action list. */
  function actionHttp(providerInstances: Array<Record<string, unknown>>, actions: Array<Record<string, unknown>>) {
    return vi.fn(async (opts: unknown) => {
      const body = reqUrl(opts).includes('/v1/ActionProviderInstance')
        ? { data: providerInstances }
        : { data: actions };
      return { statusCode: 200, headers: {}, body };
    });
  }

  it('resolves the provider instance from the queue and lists its actions by command', async () => {
    const http = actionHttp(
      [{ id: 'pi1', ConnectionString: 'conn-1' }],
      [{ id: 'a1', Name: 'Do Thing', Command: 'DoThing' }, { id: 'a2', Command: 'Bare' }],
    );
    const ctx = makeLoadOptionsCtx({ params: { queue: 'conn-1' }, http });
    const res = await searchActions.call(ctx);
    expect(res.results).toEqual([
      { name: 'Do Thing (DoThing)', value: 'DoThing' },
      { name: 'Bare', value: 'Bare' },
    ]);
    // the Action query targets the resolved provider instance id
    const actionCall = http.mock.calls.find((c) => reqUrl(c[0]).includes('/v1/Action') && !reqUrl(c[0]).includes('ProviderInstance'));
    expect(actionCall).toBeDefined();
  });

  it('returns nothing when no queue is selected', async () => {
    const res = await searchActions.call(makeLoadOptionsCtx({ params: {} }));
    expect(res.results).toEqual([]);
  });

  it('returns nothing when the queue matches no provider instance', async () => {
    const http = actionHttp([], []);
    const ctx = makeLoadOptionsCtx({ params: { queue: 'missing' }, http });
    const res = await searchActions.call(ctx);
    expect(res.results).toEqual([]);
  });
});
