import type { IExecuteFunctions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { Servicely } from '../Servicely.node';
import { EQUALS_UI_VALUE } from '../constants';
import { makeExecuteCtx, makeHttpStub, ok, type ExecuteCtxOptions } from './_stubs';

const node = new Servicely();

/** Run `execute` against a stubbed context and return the emitted items. */
async function run(options: ExecuteCtxOptions) {
  const ctx = makeExecuteCtx(options);
  const [items] = await node.execute.call(ctx as IExecuteFunctions);
  return items;
}

describe('node description', () => {
  it('declares the three resources and the credential', () => {
    expect(node.description.credentials).toEqual([{ name: 'servicelyApi', required: true }]);
    const resource = node.description.properties.find((property) => property.name === 'resource');
    expect(resource?.options?.map((option) => 'value' in option && option.value)).toEqual([
      'object',
      'attachment',
      'queue',
    ]);
  });

  it('exposes every listSearch method the resourceLocators reference', () => {
    const referenced = new Set<string>();
    for (const property of node.description.properties) {
      for (const mode of property.modes ?? []) {
        const method = mode.typeOptions?.searchListMethod;
        if (method) {
          referenced.add(method);
        }
      }
    }

    expect(referenced.size).toBeGreaterThan(0);
    for (const method of referenced) {
      expect(node.methods.listSearch).toHaveProperty(method);
    }
  });
});

describe('object resource', () => {
  it('creates a record from the Fields to Set rows', async () => {
    const http = makeHttpStub([ok({ id: '1', ShortDescription: 'printer down' })]);
    const items = await run({
      http,
      params: {
        resource: 'object',
        operation: 'create',
        tableName: 'Incident',
        'fieldsToSet.field': [
          { name: 'ShortDescription', value: 'printer down' },
          { name: '', value: 'dropped' },
        ],
      },
    });

    expect(http.calls[0].options.method).toBe('POST');
    expect(http.calls[0].options.url).toBe('/v1/Incident');
    expect(http.calls[0].options.body).toEqual({ ShortDescription: 'printer down' });
    expect(items).toEqual([{ json: { id: '1', ShortDescription: 'printer down' }, pairedItem: { item: 0 } }]);
  });

  it('gets a single record with only the selector options', async () => {
    const http = makeHttpStub([ok({ id: 'r1' })]);
    await run({
      http,
      params: {
        resource: 'object',
        operation: 'get',
        tableName: 'Incident',
        recordId: 'r1',
        'options.fields': 'id,Number',
        'options.sortField': 'CreatedOn',
      },
    });

    expect(http.calls[0].options.url).toBe('/v1/Incident/r1');
    expect(http.calls[0].options.qs).toEqual({ fields: 'id,Number' });
  });

  it('gets many records up to the limit', async () => {
    const http = makeHttpStub([ok([{ id: '1' }, { id: '2' }, { id: '3' }])]);
    const items = await run({
      http,
      params: {
        resource: 'object',
        operation: 'getAll',
        tableName: 'Incident',
        limit: 2,
        'filters.conditions': [{ fieldName: 'State', operator: EQUALS_UI_VALUE, value: 'Open' }],
      },
    });

    expect(http.calls[0].options.qs).toEqual({
      page: 1,
      page_size: 2,
      query: '{"and":[{"fieldName":"State","operator":"=","value":"Open"}]}',
    });
    expect(items).toHaveLength(2);
  });

  it('pages through everything when Return All is set', async () => {
    const fullPage = Array.from({ length: 200 }, (_, i) => ({ id: String(i) }));
    const http = makeHttpStub([ok(fullPage), ok([{ id: '200' }])]);
    const items = await run({
      http,
      params: { resource: 'object', operation: 'getAll', tableName: 'Incident', returnAll: true },
    });

    expect(items).toHaveLength(201);
    expect(http.count()).toBe(2);
  });

  it('updates a record with PATCH', async () => {
    const http = makeHttpStub([ok({ id: 'r1', State: 'Closed' })]);
    await run({
      http,
      params: {
        resource: 'object',
        operation: 'update',
        tableName: 'Incident',
        recordId: 'r1',
        'fieldsToSet.field': [{ name: 'State', value: 'Closed' }],
      },
    });

    expect(http.calls[0].options.method).toBe('PATCH');
    expect(http.calls[0].options.url).toBe('/v1/Incident/r1');
    expect(http.calls[0].options.body).toEqual({ State: 'Closed' });
  });

  it('deletes a record and reports the outcome', async () => {
    const http = makeHttpStub([{ status: 204 }]);
    const items = await run({
      http,
      params: { resource: 'object', operation: 'delete', tableName: 'Incident', recordId: 'r1' },
    });

    expect(http.calls[0].options.method).toBe('DELETE');
    expect(items[0].json).toEqual({ success: true, table: 'Incident', id: 'r1' });
  });

  it('rejects an unknown operation', async () => {
    await expect(run({ params: { resource: 'object', operation: 'frobnicate' } })).rejects.toThrow(
      /The operation "frobnicate" is not supported for resource "object"/,
    );
  });
});

describe('attachment resource', () => {
  it('lists attachments for a parent record, adding the Related Field filter', async () => {
    const http = makeHttpStub([ok([{ id: 'a1', FileName: 'x.png' }])]);
    const items = await run({
      http,
      params: {
        resource: 'attachment',
        operation: 'list',
        parentTable: 'Incident',
        parentRecordId: 'r1',
        relatedField: 'Attachments',
      },
    });

    expect(http.calls[0].options.url).toBe('/v1/Attachment');
    expect(http.calls[0].options.qs).toEqual({
      fields: 'id,FileName,MimeType,RelatedField,ParentRecord',
      query: JSON.stringify({
        and: [
          { fieldName: 'ParentRecord', operator: '=', value: 'r1:Incident' },
          { fieldName: 'RelatedField', operator: '=', value: 'Attachments' },
        ],
      }),
    });
    expect(items).toHaveLength(1);
  });

  it('matches any field when Related Field is blank', async () => {
    const http = makeHttpStub([ok([])]);
    await run({
      http,
      params: {
        resource: 'attachment',
        operation: 'list',
        parentTable: 'Incident',
        parentRecordId: 'r1',
        relatedField: '',
      },
    });

    expect(http.calls[0].options.qs?.query).toBe(
      JSON.stringify({ and: [{ fieldName: 'ParentRecord', operator: '=', value: 'r1:Incident' }] }),
    );
  });

  it('downloads an attachment into a binary field', async () => {
    const http = makeHttpStub([
      ok({
        id: 'a1',
        FileName: 'note.txt',
        MimeType: 'text/plain',
        RelatedField: 'Attachments',
        ParentRecord: 'r1:Incident',
        Data: Buffer.from('hello').toString('base64'),
      }),
    ]);
    const items = await run({
      http,
      params: { resource: 'attachment', operation: 'download', attachmentId: 'a1', binaryPropertyName: 'file' },
    });

    expect(http.calls[0].options.url).toBe('/v1/Attachment/a1');
    expect(items[0].json).toEqual({
      id: 'a1',
      fileName: 'note.txt',
      mimeType: 'text/plain',
      relatedField: 'Attachments',
      parentRecord: 'r1:Incident',
    });
    expect(items[0].binary?.file.data).toBe(Buffer.from('hello').toString('base64'));
  });

  it('tolerates an attachment with no Data', async () => {
    const http = makeHttpStub([ok({ id: 'a1', FileName: 'empty', MimeType: 'text/plain' })]);
    const items = await run({
      http,
      params: { resource: 'attachment', operation: 'download', attachmentId: 'a1' },
    });

    expect(items[0].binary?.data.data).toBe('');
  });

  it('uploads a binary field, defaulting the name, type, and related field', async () => {
    const http = makeHttpStub([ok({ id: 'a2' })]);
    await run({
      http,
      binary: { buffer: Buffer.from('hi') },
      params: { resource: 'attachment', operation: 'upload', parentTable: 'Incident', parentRecordId: 'r1' },
    });

    expect(http.calls[0].options.body).toEqual({
      MimeType: 'application/octet-stream',
      FileName: 'file',
      Data: Buffer.from('hi').toString('base64'),
      RelatedField: 'Attachments',
      ParentRecord: 'r1:Incident',
    });
  });

  it('prefers the explicit file name and MIME type over the binary metadata', async () => {
    const http = makeHttpStub([ok({ id: 'a3' })]);
    await run({
      http,
      binary: { buffer: Buffer.from('hi'), fileName: 'from-binary.txt', mimeType: 'text/plain' },
      params: {
        resource: 'attachment',
        operation: 'upload',
        parentTable: 'Incident',
        parentRecordId: 'r1',
        fileName: 'override.png',
        mimeType: 'image/png',
        relatedField: 'Evidence',
      },
    });

    expect(http.calls[0].options.body).toMatchObject({
      FileName: 'override.png',
      MimeType: 'image/png',
      RelatedField: 'Evidence',
    });
  });

  it('rejects an unknown operation', async () => {
    await expect(run({ params: { resource: 'attachment', operation: 'sideload' } })).rejects.toThrow(
      /The operation "sideload" is not supported for resource "attachment"/,
    );
  });
});

describe('queue resource', () => {
  it.each([
    ['replySuccess', 'success', 'ok'],
    ['replyFailure', 'fail', 'error'],
  ])('acknowledges a message via %s', async (operation, action, status) => {
    const http = makeHttpStub([{ status: 200, body: {} }]);
    const items = await run({
      http,
      params: { resource: 'queue', operation, replyTo: 'm1', payload: { done: true } },
    });

    expect(http.calls[0].options.url).toBe('/controller/AsyncIntegration');
    expect(http.calls[0].options.body).toEqual({
      reply_to: 'm1',
      action,
      identifier: 'n8n',
      status,
      payload: { done: true },
    });
    expect(items[0].json).toEqual({ success: true, replyTo: 'm1', action });
  });

  it('rejects an unknown operation', async () => {
    await expect(run({ params: { resource: 'queue', operation: 'replyMaybe' } })).rejects.toThrow(
      /The operation "replyMaybe" is not supported for resource "queue"/,
    );
  });
});

describe('error handling', () => {
  it('rejects an unknown resource', async () => {
    await expect(run({ params: { resource: 'widget', operation: 'get' } })).rejects.toThrow(
      /is not supported for resource "widget"/,
    );
  });

  it('collects the error per item when Continue On Fail is set', async () => {
    const http = makeHttpStub([{ status: 404, body: {} }]);
    const items = await run({
      http,
      continueOnFail: true,
      items: [{ json: {} }, { json: {} }],
      params: {
        resource: 'object',
        operation: 'get',
        tableName: 'Incident',
        recordId: 'missing',
        requestOptions: { maxRetries: 0 },
      },
    });

    expect(items).toHaveLength(2);
    expect(items[0].json.error).toMatch(/Record not found/);
    expect(items[1].pairedItem).toEqual({ item: 1 });
  });

  it('reports the failing item index on a malformed advanced query', async () => {
    const error = await run({
      params: { resource: 'object', operation: 'getAll', tableName: 'Incident', 'options.query': '{nope' },
    }).catch((e: unknown) => e);

    expect((error as Error).message).toMatch(/Invalid Query JSON/);
  });

  it('processes every input item', async () => {
    const http = makeHttpStub([ok({ id: '1' })]);
    const items = await run({
      http,
      items: [{ json: {} }, { json: {} }, { json: {} }],
      params: { resource: 'object', operation: 'get', tableName: 'Incident', recordId: 'r1' },
    });

    expect(items).toHaveLength(3);
    expect(http.count()).toBe(3);
    expect(items.map((item) => item.pairedItem)).toEqual([{ item: 0 }, { item: 1 }, { item: 2 }]);
  });
});
