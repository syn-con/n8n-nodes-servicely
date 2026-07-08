/**
 * Pure query builders shared by the CRUD handler (Get Many) and the polling
 * trigger's Object mode (DRY). These take already-read parameter values and
 * turn them into the Servicely `query` shape; they never touch n8n context, so
 * they are trivially unit-testable and reusable across execution and polling.
 */

import type { IDataObject } from 'n8n-workflow';

import { parseList } from './methods/resolve';
import type { QueryCriterion, QueryOperator, ServicelyQuery } from './types';

/**
 * UI value for the Equals operator. n8n treats any options value starting with
 * `=` as an expression, so `=` cannot itself be an options value — the dropdown
 * would render it as an empty expression and never stay selected. The Operator
 * dropdown therefore stores `eq`, which `toApiOperator` translates back to `=`.
 */
export const EQUALS_UI_VALUE = 'eq';

/** A single simple-mode filter row from a `filters` fixedCollection. */
export interface FilterCondition {
  fieldName: string;
  operator: QueryOperator | typeof EQUALS_UI_VALUE;
  value?: string;
}

/** Operators that take no value. */
const VALUELESS_OPERATORS: ReadonlySet<QueryOperator> = new Set(['isempty', 'isnotempty']);
/** Operators whose value is a comma-separated list. */
const LIST_OPERATORS: ReadonlySet<QueryOperator> = new Set(['in', 'notIn', 'between']);

/** Map a UI operator token to the API operator (only Equals is aliased). */
function toApiOperator(operator: FilterCondition['operator']): QueryOperator {
  return operator === EQUALS_UI_VALUE ? '=' : operator;
}

/** Convert one simple-mode filter row into a query criterion. */
export function toCriterion(condition: FilterCondition): QueryCriterion {
  const { fieldName } = condition;
  const operator = toApiOperator(condition.operator);
  if (VALUELESS_OPERATORS.has(operator)) {
    return { fieldName, operator };
  }
  if (LIST_OPERATORS.has(operator)) {
    return { fieldName, operator, value: parseList(condition.value ?? '') };
  }
  return { fieldName, operator, value: condition.value ?? '' };
}

/** Build an AND query from simple filter rows, ignoring rows with no field. */
export function buildAndQuery(conditions: FilterCondition[]): ServicelyQuery | undefined {
  const criteria = conditions.filter((c) => c.fieldName).map(toCriterion);
  return criteria.length > 0 ? { and: criteria } : undefined;
}

/**
 * Parse an advanced Query option that may arrive as a JSON string or as an
 * already-parsed object (from an expression). Returns `undefined` when empty.
 */
export function parseAdvancedQuery(raw: string | IDataObject | undefined): ServicelyQuery | undefined {
  if (!raw || (typeof raw === 'string' && raw.trim() === '')) {
    return undefined;
  }
  if (typeof raw !== 'string') {
    return raw as ServicelyQuery;
  }
  try {
    return JSON.parse(raw) as ServicelyQuery;
  } catch (error) {
    throw new Error(`Invalid Query JSON: ${(error as Error).message}`);
  }
}
