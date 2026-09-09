import type { INodeProperties, INodeTypeDescription } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { Servicely } from '../Servicely/Servicely.node';
import { ServicelyTrigger } from '../Servicely/ServicelyTrigger.node';
import { ServicelySoFiAIWebhookTrigger } from '../ServicelySoFiAIWebhook/ServicelySoFiAIWebhookTrigger.node';

/**
 * Guards on what a `displayOptions` condition is allowed to name, for every node
 * the package registers.
 *
 * The failure mode this exists for, as `n8n-workflow`'s `node-helpers` implements
 * it: `getParameterDependencies` reads one flat level of parameters and takes every
 * `displayOptions` key, verbatim, as a dependency name; `getParameterResolveOrder`
 * then orders that level, re-queueing a parameter whose dependency is not resolved
 * yet. A name that is not a parameter of the level never resolves, so it re-queues
 * forever and the sort aborts with `Could not resolve parameter dependencies. Max
 * iterations reached!` — the node's settings panel never opens, while every unit
 * test and both linters still pass.
 *
 * The only names exempt are `@`-prefixed (n8n's own, e.g. `@version`) and
 * `/`-prefixed, which the resolver assumes resolved at the root. n8n-workflow 2.x
 * added a guard that skips an unknown name instead of spinning, so how loudly this
 * fails depends on the n8n version — which is reason to keep it out of the
 * descriptions rather than reason to relax the rule.
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
  ['ServicelySoFiAIWebhookTrigger', new ServicelySoFiAIWebhookTrigger().description],
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
 * The parameter a `displayOptions` key names.
 *
 * Matched exactly, bar a leading `/`, because that is what n8n does:
 * `getParameterDependencies` takes the key verbatim as the dependency name and
 * `getParameterResolveOrder` compares it against the level's parameter names, so
 * a key like `tableName.value` names nothing and hangs the resolver as surely as
 * a misspelling would. Only the `/` prefix is special — the resolver assumes a
 * root-level dependency is already resolved. `@version` and the other `@` keys are
 * n8n's own and are skipped before any of this.
 */
function referencedParameter(key: string): string | undefined {
  return key.startsWith('@') ? undefined : key.replace(/^\//, '');
}

/**
 * The parameter a `loadOptionsDependsOn` entry names. A different mechanism from
 * `displayOptions`, and one that does address into a value: `tableName.value` is
 * how n8n's own nodes depend on a resourceLocator's inner value, so the path is
 * trimmed to the parameter it starts at.
 */
function dependsOnParameter(key: string): string | undefined {
  const [name] = key.replace(/^\//, '').split('.');
  return name.startsWith('@') ? undefined : name;
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
          const referenced = dependsOnParameter(key);
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
