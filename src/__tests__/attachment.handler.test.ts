import { describe, expect, it, vi } from 'vitest';

import { executeAttachmentOperation } from '../handlers/attachment.handler';
import type { IServicelyClient } from '../types';
import { makeCtx } from './_stubs';

function mockClient(overrides: Partial<IServicelyClient> = {}): IServicelyClient {
  return {
    get: vi.fn(async () => ({ data: [], meta: { hasMore: false } })),
    getOne: vi.fn(async () => ({ id: '1' })),
    create: vi.fn(async () => ({ id: 'att1' })),
    update: vi.fn(async () => ({ id: '1' })),
    replace: vi.fn(async () => ({ id: '1' })),
    delete: vi.fn(async () => undefined),
    batch: vi.fn(async () => ({ id: 'b', requests: [] })),
    ...overrides,
  };
}

describe('attachment handler — list', () => {
  it('queries the Attachment table by the ParentRecord ref', async () => {
    const get = vi.fn(async () => ({ data: [{ id: 'a1', FileName: 'x.png' }], meta: { hasMore: false } }));
    const ctx = makeCtx({ params: { parentTable: 'Incident', parentRecordId: '5', relatedField: 'Attachments' } });
    const out = await executeAttachmentOperation(ctx, mockClient({ get }), 'list', 0);
    expect(out).toHaveLength(1);
    expect(get).toHaveBeenCalledWith('Attachment', expect.objectContaining({
      query: {
        and: [
          { fieldName: 'ParentRecord', operator: '=', value: '5:Incident' },
          { fieldName: 'RelatedField', operator: '=', value: 'Attachments' },
        ],
      },
    }));
  });

  it('omits the RelatedField criterion when not provided', async () => {
    const get = vi.fn(async () => ({ data: [], meta: { hasMore: false } }));
    const ctx = makeCtx({ params: { parentTable: 'Incident', parentRecordId: '5', relatedField: '' } });
    await executeAttachmentOperation(ctx, mockClient({ get }), 'list', 0);
    const query = (get.mock.calls[0][1] as { query: { and: unknown[] } }).query;
    expect(query.and).toHaveLength(1);
  });
});

describe('attachment handler — upload', () => {
  it('builds the attachment payload with base64 data and the parent ref', async () => {
    const create = vi.fn(async () => ({ id: 'att1' }));
    const ctx = makeCtx({
      params: {
        parentTable: 'Incident',
        parentRecordId: '5',
        relatedField: 'Attachments',
        binaryPropertyName: 'data',
        fileName: 'report.pdf',
        mimeType: 'application/pdf',
      },
      binary: { fileName: 'report.pdf', mimeType: 'application/pdf', buffer: Buffer.from('hello') },
    });
    await executeAttachmentOperation(ctx, mockClient({ create }), 'upload', 0);
    expect(create).toHaveBeenCalledWith('Attachment', {
      MimeType: 'application/pdf',
      FileName: 'report.pdf',
      Data: Buffer.from('hello').toString('base64'),
      RelatedField: 'Attachments',
      ParentRecord: '5:Incident',
    });
  });

  it('falls back to the binary metadata for name/mime when overrides are blank', async () => {
    const create = vi.fn(async () => ({ id: 'att1' }));
    const ctx = makeCtx({
      params: { parentTable: 'Incident', parentRecordId: '5', relatedField: '', binaryPropertyName: 'data', fileName: '', mimeType: '' },
      binary: { fileName: 'auto.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') },
    });
    await executeAttachmentOperation(ctx, mockClient({ create }), 'upload', 0);
    expect(create).toHaveBeenCalledWith('Attachment', expect.objectContaining({
      FileName: 'auto.txt',
      MimeType: 'text/plain',
      RelatedField: 'Attachments', // defaulted
    }));
  });
});

describe('attachment handler — upload fallbacks', () => {
  it('defaults file name and MIME type when neither override nor binary metadata is present', async () => {
    const create = vi.fn(async () => ({ id: 'att1' }));
    const ctx = makeCtx({
      params: { parentTable: 'Incident', parentRecordId: '5', relatedField: 'Attachments', binaryPropertyName: 'data', fileName: '', mimeType: '' },
      binary: { buffer: Buffer.from('x') }, // no fileName / mimeType on the binary
    });
    await executeAttachmentOperation(ctx, mockClient({ create }), 'upload', 0);
    expect(create).toHaveBeenCalledWith('Attachment', expect.objectContaining({
      FileName: 'file',
      MimeType: 'application/octet-stream',
    }));
  });
});

describe('attachment handler — download', () => {
  it('handles an attachment record with no Data (empty binary)', async () => {
    const getOne = vi.fn(async () => ({ id: 'att1', FileName: 'empty.bin', MimeType: 'application/octet-stream' }));
    const ctx = makeCtx({ params: { attachmentId: 'att1', binaryPropertyName: 'data' } });
    const out = await executeAttachmentOperation(ctx, mockClient({ getOne }), 'download', 0);
    expect(out[0].binary?.data).toMatchObject({ data: '' });
  });

  it('fetches the attachment and emits binary output', async () => {
    const getOne = vi.fn(async () => ({
      id: 'att1',
      FileName: 'note.txt',
      MimeType: 'text/plain',
      RelatedField: 'Attachments',
      ParentRecord: '5:Incident',
      Data: Buffer.from('content').toString('base64'),
    }));
    const ctx = makeCtx({ params: { attachmentId: 'att1', binaryPropertyName: 'data' } });
    const out = await executeAttachmentOperation(ctx, mockClient({ getOne }), 'download', 0);
    expect(out[0].json).toMatchObject({ id: 'att1', fileName: 'note.txt', mimeType: 'text/plain' });
    expect(out[0].binary?.data).toMatchObject({
      data: Buffer.from('content').toString('base64'),
      fileName: 'note.txt',
      mimeType: 'text/plain',
    });
  });
});

describe('attachment handler — routing', () => {
  it('rejects an unknown operation', async () => {
    const ctx = makeCtx({ params: {} });
    await expect(executeAttachmentOperation(ctx, mockClient(), 'nope', 0)).rejects.toThrow(/Unsupported Attachment operation/);
  });
});
