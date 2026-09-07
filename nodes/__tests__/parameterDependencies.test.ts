import type { INodeProperties, INodeTypeDescription } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { Servicely } from '../Servicely/Servicely.node';
import { ServicelyTrigger } from '../Servicely/ServicelyTrigger.node';
import { ServicelyAIToolTrigger } from '../ServicelyAITool/ServicelyAIToolTrigger.node';

/**
 * Guards on what a `displayOptions` condition is allowed to name, for every node
 * the package registers.
 *
 * The failure mode this exists for: n8n's editor orders a node's parameters by
 * resolving the dependencies their `displayOptions` declare, and a condition
 * naming a parameter the node does not have is one it can never resolve. It gives
 * up with `Could not resolve parameter dependencies. Max iterations reached!` and
 * the node's settings panel never opens — so the node is unusable in the UI while
 * every unit test and both linters still pass.
 *
 * It is a property fragment shared between nodes that gets this wrong: the one
 * that carries a `displayOptions` is correct on the node it was written for and
 * dangling on the node that reuses it. `requestOptionsProperty` did exactly that
 * between 1.2.0 and 1.3.1 — it hid itself for `resource: aiAgentTool`, which the
 * Servicely node has and the trigger does not.
 */

const NODES: Array<[string, INodeTypeDescription]> = [
  ['Servicely', new Servicely().description],
  ['ServicelyTrigger', new ServicelyTrigger().description],
  ['ServicelyAIToolTrigger', new ServicelyAIToolTrigger().description],
];

/** Whether a `collection`/`fixedCollection` entry is a parameter rather than an option. */
function isProperty(entry: unknown): entry is INodeProperties {
  return entry !== null && typeof entry === 'object' && 'name' in entry && 'type' in entry;
}

/**
 * The parameters nested inside a container. A `collection` holds them directly in
 * `options`; a `fixedCollection` holds one `values` list per named row. Anything
 * else (`options`, `multiOptions`) holds display options, not parameters.
 */
function children(property: INodeProperties): INodeProperties[] {
  const entries = property.options ?? [];
  if (property.type === 'collection') {
    return entries.filter(isProperty);
  }
  if (property.type === 'fixedCollection') {
    return entries.flatMap((entry) => ('values' in entry ? entry.values : []));
  }
  return [];
}

/** Every parameter name a `displayOptions` block names, `show` and `hide` alike. */
function conditionKeys(property: INodeProperties): string[] {
  const { show = {}, hide = {} } = property.displayOptions ?? {};
  return [...Object.keys(show), ...Object.keys(hide)];
}

/**
 * The parameter a condition key resolves to. A leading `/` reaches the node's root
 * from inside a collection, and a trailing path (`tableName.value`) addresses into
 * a resourceLocator — neither changes which parameter is named. `@version` and the
 * other `@` keys are n8n's own, not parameters.
 */
function referencedParameter(key: string): string | undefined {
  if (key.startsWith('@')) {
    return undefined;
  }
  return key.replace(/^\//, '').split('.')[0];
}

describe.each(NODES)('%s parameter dependencies', (_name, description) => {
  const properties = description.properties;
  const rootNames = new Set(properties.map((property) => property.name));

  it('only names root parameters it declares in a top-level condition', () => {
    for (const property of properties) {
      for (const key of conditionKeys(property)) {
        const referenced = referencedParameter(key);
        if (referenced === undefined) {
          continue;
        }
        expect(rootNames, `${property.name} → ${key}`).toContain(referenced);
      }
    }
  });

  it('only names a sibling, or a root parameter via a leading slash, from inside a collection', () => {
    /** Walk containers, checking each child against the row it sits in. */
    function walk(container: INodeProperties): void {
      const nested = children(container);
      const siblingNames = new Set(nested.map((property) => property.name));

      for (const property of nested) {
        for (const key of conditionKeys(property)) {
          const referenced = referencedParameter(key);
          if (referenced === undefined) {
            continue;
          }
          // A bare name is a sibling of the same row; `/name` reaches the root.
          // Naming a root parameter without the slash is the case n8n's own hint
          // calls out, and it hangs the resolver exactly as a dangling name does.
          const reachable = key.startsWith('/') ? rootNames : siblingNames;
          expect(reachable, `${container.name}.${property.name} → ${key}`).toContain(referenced);
        }
        walk(property);
      }
    }

    for (const property of properties) {
      walk(property);
    }
  });

  it('only names root parameters it declares in loadOptionsDependsOn', () => {
    function walk(list: INodeProperties[]): void {
      for (const property of list) {
        for (const key of property.typeOptions?.loadOptionsDependsOn ?? []) {
          const referenced = referencedParameter(key);
          if (referenced === undefined) {
            continue;
          }
          expect(rootNames, `${property.name} → ${key}`).toContain(referenced);
        }
        walk(children(property));
      }
    }

    walk(properties);
  });
});
