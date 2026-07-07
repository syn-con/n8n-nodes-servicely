import { describe, expect, it, vi } from 'vitest';

import { nodeMethods } from '../methods';
import {
  searchAttachments,
  searchObjectRecords,
  searchParentRecords,
  searchTables,
} from '../methods/listSearch';
import { makeLoadOptionsCtx } from './_stubs';

/** An httpRequest stub that returns a fixed list envelope. */
function listHttp(records: Array<Record<string, unknown>>) {
  return vi.fn(async () => ({ statusCode: 200, headers: {}, body: { data: records } }));
}

describe('nodeMethods', () => {
  it('registers the listSearch methods used by the resourceLocators', () => {
    expect(Object.keys(nodeMethods.listSearch)).toEqual([
      'searchTables',
      'searchObjectRecords',
      'searchParentRecords',
      'searchAttachments',
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
