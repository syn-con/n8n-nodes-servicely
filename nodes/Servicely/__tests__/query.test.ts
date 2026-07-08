import { describe, expect, it } from 'vitest';

import { buildAndQuery, EQUALS_UI_VALUE, parseAdvancedQuery, toCriterion, type FilterCondition } from '../query';

describe('query — toCriterion', () => {
  it('translates the Equals UI token (eq) to the "=" API operator', () => {
    expect(toCriterion({ fieldName: 'State', operator: EQUALS_UI_VALUE, value: 'Open' })).toEqual({
      fieldName: 'State',
      operator: '=',
      value: 'Open',
    });
  });

  it('drops the value for valueless operators', () => {
    expect(toCriterion({ fieldName: 'ClosedOn', operator: 'isempty' })).toEqual({
      fieldName: 'ClosedOn',
      operator: 'isempty',
    });
  });

  it('parses a comma list for list operators', () => {
    expect(toCriterion({ fieldName: 'Priority', operator: 'in', value: '1, 2 ,3' })).toEqual({
      fieldName: 'Priority',
      operator: 'in',
      value: ['1', '2', '3'],
    });
  });

  it('passes a scalar value through for comparison operators', () => {
    expect(toCriterion({ fieldName: 'State', operator: '=', value: 'Open' })).toEqual({
      fieldName: 'State',
      operator: '=',
      value: 'Open',
    });
  });
});

describe('query — buildAndQuery', () => {
  it('ignores rows without a field name', () => {
    const conditions: FilterCondition[] = [
      { fieldName: 'State', operator: '=', value: 'Open' },
      { fieldName: '', operator: '=', value: 'dropped' },
    ];
    expect(buildAndQuery(conditions)).toEqual({ and: [{ fieldName: 'State', operator: '=', value: 'Open' }] });
  });

  it('returns undefined when no rows have a field', () => {
    expect(buildAndQuery([])).toBeUndefined();
  });
});

describe('query — parseAdvancedQuery', () => {
  it('returns undefined for empty/whitespace input', () => {
    expect(parseAdvancedQuery('')).toBeUndefined();
    expect(parseAdvancedQuery('   ')).toBeUndefined();
    expect(parseAdvancedQuery(undefined)).toBeUndefined();
  });

  it('parses a JSON string', () => {
    expect(parseAdvancedQuery('{"and":[]}')).toEqual({ and: [] });
  });

  it('returns an object input verbatim', () => {
    const obj = { or: [{ fieldName: 'X', operator: '=', value: 1 }] };
    expect(parseAdvancedQuery(obj)).toBe(obj);
  });

  it('throws a helpful error on invalid JSON', () => {
    expect(() => parseAdvancedQuery('{bad')).toThrow(/Invalid Query JSON/);
  });
});
