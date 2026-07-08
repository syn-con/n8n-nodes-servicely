import type { IDisplayOptions, INodeProperties } from 'n8n-workflow';

/**
 * Shared builders for the node's expression-first reference fields.
 *
 * Every reference (table, record) is a `resourceLocator`: the default "From
 * List" mode loads options dynamically, while a second mode accepts a raw
 * name/id or an expression for direct use. This is n8n's native manual-vs-ID
 * toggle, so no bespoke switch is needed.
 */

interface TableLocatorConfig {
  name: string;
  displayName: string;
  description: string;
  displayOptions: IDisplayOptions;
  default?: string;
}

interface RecordLocatorConfig {
  name: string;
  displayName: string;
  description: string;
  /** `methods.listSearch` key that populates the "From List" mode. */
  searchListMethod: string;
  displayOptions: IDisplayOptions;
}

/** A Table reference: dynamic curated list, or a typed/expression table name. */
export function tableResourceLocator(config: TableLocatorConfig): INodeProperties {
  return {
    displayName: config.displayName,
    name: config.name,
    type: 'resourceLocator',
    default: { mode: 'list', value: config.default ?? '' },
    required: true,
    description: config.description,
    displayOptions: config.displayOptions,
    modes: [
      {
        // Discovery unions several metadata queries, so load once and let n8n
        // filter the returned list client-side rather than re-query per keystroke.
        displayName: 'From List',
        name: 'list',
        type: 'list',
        typeOptions: { searchListMethod: 'searchTables', searchable: false },
      },
      {
        displayName: 'By Name',
        name: 'name',
        type: 'string',
        hint: 'Enter a table name (e.g. Incident) or an expression',
        placeholder: 'Incident',
      },
    ],
  };
}

/** A Record reference: dynamic searchable list, or a typed/expression record id. */
export function recordResourceLocator(config: RecordLocatorConfig): INodeProperties {
  return {
    displayName: config.displayName,
    name: config.name,
    type: 'resourceLocator',
    default: { mode: 'id', value: '' },
    required: true,
    description: config.description,
    displayOptions: config.displayOptions,
    modes: [
      {
        displayName: 'From List',
        name: 'list',
        type: 'list',
        typeOptions: { searchListMethod: config.searchListMethod, searchable: true },
      },
      {
        displayName: 'By ID',
        name: 'id',
        type: 'string',
        hint: 'Enter a record id or an expression',
        placeholder: 'e.g. c0a80101-...',
      },
    ],
  };
}
