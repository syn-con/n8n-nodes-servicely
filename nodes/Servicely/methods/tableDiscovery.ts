import type { IServicelyClient, ServicelyRecord } from '../types';

/**
 * Hands-free table discovery.
 *
 * Servicely's REST API exposes no master table-registry endpoint (no Swagger,
 * and generic "metadata"/"entity" probes return unrelated rows — e.g. `Entity`
 * is a named-pattern store). Instead, table names are gathered at runtime from
 * documented metadata tables whose rows reference real leaf tables, verified
 * against a live instance:
 *
 *  - `SequenceNumber` — one row per numbered table; its `Table` field holds the
 *    exact PascalCase table name (Incident, Change, Problem, Asset, and custom
 *    "C_"/"AD_"-prefixed tables). This is the primary, confirmed source.
 *  - `cmdbmetadata`   — the CMDB class registry.
 *
 * These sources can name tables that aren't actually queryable (e.g. rows left
 * behind by uninstalled apps — `CalendarEvent` 404s), so every candidate is
 * validated in a single `_batch` round trip and any that returns a client/server
 * error is dropped. Each source is best-effort and casing-robust (both the
 * scripting lowercase and REST PascalCase spellings are tried, field names match
 * case-insensitively). The result is de-duplicated and sorted, and is never
 * fabricated — anything not covered is reachable via the resourceLocator
 * "By Name" / expression mode.
 */

/** Metadata tables to read, and the (case-insensitive) field holding a table name. */
const TABLE_SOURCES: ReadonlyArray<{ table: string; field: string }> = [
  { table: 'SequenceNumber', field: 'table' },
  { table: 'cmdbmetadata', field: 'name' },
];

/** Numbering/CMDB registries are small; one large page captures them all. */
const PAGE_SIZE = 2000;

/** Both the scripting (lowercase) and REST (PascalCase) spellings of an entity. */
function casings(name: string): string[] {
  const pascal = name.charAt(0).toUpperCase() + name.slice(1);
  return [...new Set([name, pascal])];
}

/** Non-empty string value whose (lowercased) key matches `field`. */
function valueForKey(row: ServicelyRecord, field: string): string | undefined {
  const wanted = field.toLowerCase();
  const key = Object.keys(row).find((k) => k.toLowerCase() === wanted);
  const value = key === undefined ? undefined : row[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** Read `field` off every row of a metadata table, trying name casings, tolerating errors. */
async function namesFrom(client: IServicelyClient, table: string, field: string): Promise<string[]> {
  for (const name of casings(table)) {
    try {
      // eslint-disable-next-line no-await-in-loop -- casings are tried in order until one responds
      const { data } = await client.get<ServicelyRecord>(name, { page_size: PAGE_SIZE });
      const names = data.map((row) => valueForKey(row, field)).filter((n): n is string => n !== undefined);
      if (names.length > 0) {
        return names;
      }
    } catch {
      // this casing is absent/forbidden; try the next
    }
  }
  return [];
}

/**
 * Drop candidates that don't resolve to a real REST table. One `_batch` probes
 * every name; only names whose sub-response is an explicit error (>= 400) are
 * removed. If batch is unavailable the candidates are kept unfiltered (better a
 * superset than an empty list).
 */
async function dropMissingTables(client: IServicelyClient, names: string[]): Promise<string[]> {
  if (names.length === 0) {
    return names;
  }
  try {
    const response = await client.batch(
      names.map((table, index) => ({
        id: String(index + 1),
        method: 'GET' as const,
        url: `/v1/${table}?page_size=1`,
        body: null,
      })),
    );
    const missing = new Set<string>();
    for (const subResponse of response.requests) {
      const name = names[Number(subResponse.id) - 1];
      if (name !== undefined && subResponse.status_code >= 400) {
        missing.add(name);
      }
    }
    return names.filter((name) => !missing.has(name));
  } catch {
    return names;
  }
}

/** Discover instance table names from confirmed metadata sources (validated, deduped, sorted). */
export async function discoverTables(client: IServicelyClient): Promise<string[]> {
  const perSource = await Promise.all(TABLE_SOURCES.map((source) => namesFrom(client, source.table, source.field)));

  const byKey = new Map<string, string>();
  for (const name of perSource.flat()) {
    const key = name.toLowerCase();
    if (!byKey.has(key)) {
      byKey.set(key, name);
    }
  }

  const existing = await dropMissingTables(client, [...byKey.values()]);
  return existing.sort((a, b) => a.localeCompare(b));
}
