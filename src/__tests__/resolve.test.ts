import { describe, expect, it } from 'vitest';

import { parseList } from '../methods/resolve';

describe('parseList', () => {
  it('splits a plain comma string and trims each token', () => {
    expect(parseList('1, 2 ,3')).toEqual(['1', '2', '3']);
  });

  it('parses a JSON array string', () => {
    expect(parseList('[1, 2, 3]')).toEqual(['1', '2', '3']);
  });

  it('parses a single-quoted array with labels', () => {
    expect(parseList("[1, 'Option Test', 3]")).toEqual(['1', 'Option Test', '3']);
  });

  it('mixes ordinals and labels in a comma string', () => {
    expect(parseList('1, Option Test, 3')).toEqual(['1', 'Option Test', '3']);
  });

  it('passes an existing array through, stringifying entries', () => {
    expect(parseList([1, 'a', ' b '])).toEqual(['1', 'a', 'b']);
  });

  it('strips surrounding single and double quotes on csv tokens', () => {
    expect(parseList('"a", \'b\'')).toEqual(['a', 'b']);
  });

  it('falls back to csv when bracket content is not valid JSON', () => {
    expect(parseList('[a, b]')).toEqual(['a', 'b']);
  });

  it('treats a non-array JSON scalar as a single csv token', () => {
    expect(parseList('5')).toEqual(['5']);
  });

  it('drops empty entries', () => {
    expect(parseList('1,,2, ,3')).toEqual(['1', '2', '3']);
  });

  it('returns [] for empty and nullish input', () => {
    expect(parseList('')).toEqual([]);
    expect(parseList('   ')).toEqual([]);
    expect(parseList(null)).toEqual([]);
    expect(parseList(undefined)).toEqual([]);
  });
});
