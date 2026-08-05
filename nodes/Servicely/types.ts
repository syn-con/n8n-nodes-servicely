/**
 * Types for the Servicely JSON REST API (v1) surface the nodes actually use.
 *
 * Mirrors the API documented at
 * https://docs-servicely.atlassian.net/wiki/spaces/SD/pages/2077523978
 */

import type { IDataObject } from 'n8n-workflow';

import type { EQUALS_UI_VALUE } from './constants';

/** Any Servicely table record. Always carries an `id`; other fields are dynamic. */
export interface ServicelyRecord {
  id: string;
  [field: string]: unknown;
}

/**
 * Fields on an `Attachment` table record. `ParentRecord` uses the
 * `{recordId}:{tableName}` format (e.g. `abc123:Incident`).
 */
export interface AttachmentRecord extends ServicelyRecord {
  MimeType: string;
  FileName: string;
  Data?: string;
  RelatedField: string;
  ParentRecord: string;
}

// ---------------------------------------------------------------------------
// Querying
// ---------------------------------------------------------------------------

/** Comparison/match operators supported by the `query` parameter. */
export type QueryOperator =
  | '='
  | '!='
  | 'startswith'
  | 'contains'
  | 'doesnotcontain'
  | 'isempty'
  | 'isnotempty'
  | 'in'
  | 'notIn'
  | '<'
  | '>'
  | '<='
  | '>='
  | 'between';

/** A single query condition. `fieldName` may dot-walk relations (e.g. `Manager.Email`). */
export interface QueryCriterion {
  fieldName: string;
  operator: QueryOperator;
  value?: unknown;
}

/** A boolean grouping of criteria/nested groups, passed (JSON-encoded) as `query`. */
export interface ServicelyQuery {
  and?: Array<QueryCriterion | ServicelyQuery>;
  or?: Array<QueryCriterion | ServicelyQuery>;
  nor?: Array<QueryCriterion | ServicelyQuery>;
}

/**
 * A single simple-mode filter row from the `filters` fixedCollection.
 * `fieldName` is a Field locator, so it is either the raw `{__rl, mode, value}`
 * object or a plain string (see `fieldRef`).
 */
export interface FilterCondition {
  fieldName: string | IDataObject;
  operator: QueryOperator | typeof EQUALS_UI_VALUE;
  value?: string;
}

// ---------------------------------------------------------------------------
// Batch API (POST /v1/_batch, requires Servicely 1.4.2+)
// ---------------------------------------------------------------------------

export interface BatchRequest {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  body?: string | null;
}

export interface BatchResponse {
  id: string;
  requests: Array<{
    id: string;
    body: string;
    execution_time: number;
    status_code: number;
    status_text: string;
  }>;
}
