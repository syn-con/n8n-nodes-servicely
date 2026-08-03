import type { INodeProperties } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import * as attachment from '../actions/attachment';
import * as object from '../actions/object';
import * as queue from '../actions/queue';
import { versionDescription } from '../actions/versionDescription';
import { listSearchMethods } from '../SearchFunctions';

/**
 * Structural guards for the actions layout. The failure mode this catches is an
 * operation file that exists but is not registered (or vice versa) — the
 * property tree and the router would silently disagree.
 */

const RESOURCES = { object, attachment, queue };

/** Operation values offered by a resource's Operation selector. */
function offeredOperations(properties: INodeProperties[], resource: string): string[] {
  const selector = properties.find(
    (property) => property.name === 'operation' && property.displayOptions?.show?.resource?.includes(resource),
  );
  return (selector?.options ?? []).map((option) => String('value' in option ? option.value : ''));
}

/** Operation modules a resource folder exports (everything but its description). */
function exportedOperations(module: Record<string, unknown>): string[] {
  return Object.keys(module).filter((key) => key !== 'description');
}

describe.each(Object.entries(RESOURCES))('%s resource', (resource, module) => {
  const offered = offeredOperations(module.description, resource);
  const exported = exportedOperations(module as unknown as Record<string, unknown>);

  it('offers at least one operation', () => {
    expect(offered.length).toBeGreaterThan(0);
  });

  it('exports exactly the operations it offers', () => {
    expect(exported.sort()).toEqual([...offered].sort());
  });

  it('gives every operation an execute function', () => {
    for (const operation of offered) {
      expect((module as unknown as Record<string, { execute?: unknown }>)[operation].execute).toBeTypeOf('function');
    }
  });

  it('scopes every one of its properties to itself', () => {
    for (const property of module.description) {
      expect(property.displayOptions?.show?.resource, `${resource}.${property.name}`).toEqual([resource]);
    }
  });
});

describe('versionDescription', () => {
  it('includes every resource in the Resource selector', () => {
    const selector = versionDescription.properties.find((property) => property.name === 'resource');
    const values = (selector?.options ?? []).map((option) => String('value' in option ? option.value : ''));

    expect(values.sort()).toEqual(Object.keys(RESOURCES).sort());
  });

  it('scopes every property to a resource, apart from the global ones', () => {
    const global = ['resource', 'requestOptions'];

    for (const property of versionDescription.properties) {
      if (global.includes(property.name)) {
        continue;
      }
      const scope = property.displayOptions?.show?.resource;
      expect(scope, property.name).toBeDefined();
      expect(Object.keys(RESOURCES)).toContain(String(scope?.[0]));
    }
  });

  it('never leaves two properties of the same name shown in the same place', () => {
    const seen = new Map<string, string[]>();

    for (const property of versionDescription.properties) {
      const key = `${property.name}:${JSON.stringify(property.displayOptions ?? {})}`;
      const previous = seen.get(key) ?? [];
      previous.push(property.displayName);
      seen.set(key, previous);
    }

    for (const [key, displayNames] of seen) {
      expect(displayNames, key).toHaveLength(1);
    }
  });

  it('only references listSearch methods that exist', () => {
    for (const property of versionDescription.properties) {
      for (const mode of property.modes ?? []) {
        const method = mode.typeOptions?.searchListMethod;
        if (method) {
          expect(listSearchMethods.listSearch, property.name).toHaveProperty(method);
        }
      }
    }
  });
});
