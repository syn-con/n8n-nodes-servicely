/**
 * Expression-friendly list parsing.
 *
 * Servicely list-valued inputs (the `in` / `notIn` / `between` operators, and
 * any future multi-select choice field) must accept the several shapes a user
 * might produce from an expression, not just a plain comma string:
 *
 *   "1, 2, 3"              → ['1', '2', '3']
 *   "1, Option Test, 3"    → ['1', 'Option Test', '3']
 *   "[1, 'Option Test', 3]"→ ['1', 'Option Test', '3']
 *   ['1', 'Option Test']   → ['1', 'Option Test']   (already an array)
 *
 * Tokens are returned verbatim (trimmed, surrounding quotes stripped). Mapping a
 * numeric ordinal or a label back to a loaded option's stored value is a
 * separate concern handled by the choice loader once field metadata is wired.
 */

/** Strip a single matching pair of surrounding single/double quotes. */
function stripQuotes(token: string): string {
  if (
    token.length >= 2 &&
    ((token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"')))
  ) {
    return token.slice(1, -1);
  }
  return token;
}

/** Split a comma-separated string into trimmed, unquoted, non-empty tokens. */
function splitCsv(raw: string): string[] {
  return raw
    .split(',')
    .map((part) => stripQuotes(part.trim()))
    .filter((part) => part !== '');
}

/** Normalize an array's entries to trimmed, non-empty strings. */
function fromArray(values: unknown[]): string[] {
  return values.map((v) => String(v).trim()).filter((v) => v !== '');
}

/**
 * Parse `raw` as a JSON array, tolerating single-quoted entries. Returns
 * `undefined` when it isn't valid JSON or the JSON value isn't an array.
 */
function tryParseJsonArray(raw: string): unknown[] | undefined {
  for (const candidate of [raw, raw.replace(/'/g, '"')]) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // not JSON in this form; try the next candidate
    }
  }
  return undefined;
}

/**
 * Normalize an expression value into a list of string tokens. Accepts a native
 * array, a JSON-array string, or a comma-separated string. Returns `[]` for
 * empty/nullish input.
 */
export function parseList(input: unknown): string[] {
  if (Array.isArray(input)) {
    return fromArray(input);
  }
  if (input === null || input === undefined) {
    return [];
  }
  const raw = String(input).trim();
  if (raw === '') {
    return [];
  }
  const jsonArray = tryParseJsonArray(raw);
  if (jsonArray) {
    return fromArray(jsonArray);
  }
  const inner = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;
  return splitCsv(inner);
}
