import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';

import { EQUALS_UI_VALUE, DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS, QUERY_OPERATORS } from '../constants';

/**
 * Property fragments shared by more than one operation. Each is declared without
 * `displayOptions`; the operation (or resource) that uses it scopes it with
 * `updateDisplayOptions`, so nothing here needs to know where it is shown.
 */

// ---------------------------------------------------------------------------
// Reference fields (resourceLocators)
// ---------------------------------------------------------------------------

/**
 * A reference the user picks from the instance (table, parent record, attachment,
 * queue, action) is a `resourceLocator`: the "From List" mode loads options
 * dynamically, while a second mode accepts a raw name/id or an expression. This
 * is n8n's native manual-vs-ID toggle, so no bespoke switch is needed. The
 * references that are not locators are the ids naming a single record — see
 * `idProperty` for why.
 */

interface TableLocatorConfig {
  name: string;
  displayName: string;
  description: string;
  default?: string;
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
    modes: [
      {
        // The registry is one small table, so load it once and let n8n filter
        // the returned list client-side rather than re-query per keystroke.
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

interface IdConfig {
  name: string;
  displayName: string;
  description: string;
}

/**
 * A record id typed by hand or arriving from an expression, for the operations
 * that address exactly one record: Object Get / Update / Delete and Attachment
 * Download. None of them gets a picker — the id is what the upstream node
 * already carries (`{{ $json.id }}`), so paging a list to find it buys nothing,
 * and for the Object operations the list would be of whatever arbitrary table is
 * selected.
 */
export function idProperty(config: IdConfig): INodeProperties {
  return {
    displayName: config.displayName,
    name: config.name,
    type: 'string',
    default: '',
    required: true,
    description: config.description,
    placeholder: 'e.g. c0a80101-...',
  };
}

interface RecordLocatorConfig {
  name: string;
  displayName: string;
  description: string;
  /** `methods.listSearch` key that populates the "From List" mode. */
  searchListMethod: string;
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

interface SearchLocatorConfig extends RecordLocatorConfig {
  /** Hint + placeholder for the manual "By Name" mode. */
  manualHint: string;
  manualPlaceholder?: string;
}

/**
 * A searchable reference whose value is a plain string rather than a record id
 * (the trigger's Queue and Action Name pickers), with a manual name/expression
 * fallback.
 */
export function searchResourceLocator(config: SearchLocatorConfig): INodeProperties {
  return {
    displayName: config.displayName,
    name: config.name,
    type: 'resourceLocator',
    default: { mode: 'list', value: '' },
    required: true,
    description: config.description,
    modes: [
      {
        displayName: 'From List',
        name: 'list',
        type: 'list',
        typeOptions: { searchListMethod: config.searchListMethod, searchable: true },
      },
      {
        displayName: 'By Name',
        name: 'name',
        type: 'string',
        hint: config.manualHint,
        placeholder: config.manualPlaceholder,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Field references
// ---------------------------------------------------------------------------

interface FieldLocatorConfig {
  name: string;
  description: string;
  /** Placeholder for the manual mode (e.g. `ShortDescription`). */
  placeholder: string;
}

/**
 * A Field reference: the fields of the selected `tableName`, from the instance's
 * `FieldDefinition` registry, or a name typed by hand.
 *
 * These locators live inside fixedCollection rows, where n8n stores the whole
 * `{mode, value}` object and `extractValue` does not reach — `fieldRef` in
 * GenericFunctions resolves both that shape and the bare strings older workflows
 * saved, so nothing needs migrating. "By Name" is what covers everything the
 * registry cannot list: a dot-walked relation, or a field on a table that is
 * itself set by expression.
 */
function fieldResourceLocator(config: FieldLocatorConfig): INodeProperties {
  return {
    displayName: 'Field Name',
    name: config.name,
    type: 'resourceLocator',
    default: { mode: 'list', value: '' },
    description: config.description,
    modes: [
      {
        // One table's field list is small, so load it once per table and let n8n
        // filter client-side rather than re-query per keystroke.
        displayName: 'From List',
        name: 'list',
        type: 'list',
        typeOptions: { searchListMethod: 'searchFields', searchable: false },
      },
      {
        displayName: 'By Name',
        name: 'name',
        type: 'string',
        hint: 'Enter a field name, a dot-walked relation (e.g. Requestor.Email), or an expression',
        placeholder: config.placeholder,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/** Friendly labels for the query operators; values stay exact (single source: QUERY_OPERATORS). */
const OPERATOR_LABELS: Record<string, string> = {
  '=': 'Equals',
  '!=': 'Not Equals',
  startswith: 'Starts With',
  contains: 'Contains',
  doesnotcontain: 'Does Not Contain',
  isempty: 'Is Empty',
  isnotempty: 'Is Not Empty',
  in: 'In (comma-separated)',
  notIn: 'Not In (comma-separated)',
  '<': 'Less Than',
  '>': 'Greater Than',
  '<=': 'Less Than or Equal',
  '>=': 'Greater Than or Equal',
  between: 'Between (comma-separated)',
};

/**
 * `options`-ready operator choices. The Equals operator uses `EQUALS_UI_VALUE`
 * instead of `=` because n8n would treat a `=` value as an expression (see
 * constants.ts); it is translated back when the query is built.
 */
export const operatorOptions: INodePropertyOptions[] = QUERY_OPERATORS.map((operator) => ({
  name: OPERATOR_LABELS[operator] ?? operator,
  value: operator === '=' ? EQUALS_UI_VALUE : operator,
}));

/**
 * The simple-mode AND filter builder, shared by Object → Get Many and the
 * trigger's Object mode so both offer an identical surface.
 */
export const filtersProperty: INodeProperties = {
  displayName: 'Filters',
  name: 'filters',
  type: 'fixedCollection',
  typeOptions: { multipleValues: true },
  default: {},
  placeholder: 'Add Condition',
  description: 'Simple conditions combined with AND. For OR/NOR or nested logic, use the raw Query (JSON) option instead.',
  options: [
    {
      name: 'conditions',
      displayName: 'Condition',
      values: [
        fieldResourceLocator({
          name: 'fieldName',
          description: 'Field to filter on, picked from the selected table or entered by name',
          placeholder: 'State',
        }),
        {
          displayName: 'Operator',
          name: 'operator',
          type: 'options',
          options: operatorOptions,
          default: EQUALS_UI_VALUE,
        },
        {
          displayName: 'Value',
          name: 'value',
          type: 'string',
          default: '',
          description: 'Value to compare. For In/Not In/Between, provide a comma-separated list. Ignored for Is Empty / Is Not Empty.',
        },
      ],
    },
  ],
};

/** The Parent Table + Parent Record pair identifying what an attachment hangs off. */
export const parentRecordProperties: INodeProperties[] = [
  tableResourceLocator({
    name: 'parentTable',
    displayName: 'Parent Table',
    description: 'Table of the record the attachment belongs to',
    default: 'Incident',
  }),
  recordResourceLocator({
    name: 'parentRecordId',
    displayName: 'Parent Record',
    description: 'The parent record the attachment belongs to',
    searchListMethod: 'searchParentRecords',
  }),
];

/** Which attachment field on the parent record to read from / write to. */
export const relatedFieldProperty: INodeProperties = {
  displayName: 'Related Field',
  name: 'relatedField',
  type: 'string',
  default: 'Attachments',
  description: 'Attachment field on the parent record (default "Attachments")',
};

// ---------------------------------------------------------------------------
// Writing records
// ---------------------------------------------------------------------------

/** The field/value rows written by Create and Update. */
export const fieldsToSetProperty: INodeProperties = {
  displayName: 'Fields to Set',
  name: 'fieldsToSet',
  type: 'fixedCollection',
  typeOptions: { multipleValues: true },
  default: {},
  placeholder: 'Add Field',
  description: 'The record fields to write',
  options: [
    {
      name: 'field',
      displayName: 'Field',
      values: [
        fieldResourceLocator({
          name: 'name',
          description: 'Field to write, picked from the selected table or entered by name',
          placeholder: 'ShortDescription',
        }),
        {
          displayName: 'Value',
          name: 'value',
          type: 'string',
          default: '',
          description: 'Value to set (for reference fields, use the related record id)',
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Options collections
// ---------------------------------------------------------------------------

/**
 * Options whose value is a field of the selected table are dropdowns fed by the
 * instance's `FieldDefinition` registry (`getFields`), not typed lists.
 *
 * `loadOptionsDependsOn` names the Table locator's inner `.value`, so changing
 * the table reloads the list rather than offering the previous table's fields.
 * `multiOptions` is n8n's only multi-select and can only be filled by a
 * `loadOptions` method, which is why `getFields` exists alongside the
 * `searchFields` listSearch behind the Field locators.
 *
 * A registry that cannot be read — or a table set by an expression, which design
 * time cannot resolve — leaves the dropdown empty; the parameter can then be
 * switched to an expression to name fields directly.
 */
const FIELD_DROPDOWN = {
  loadOptionsMethod: 'getFields',
  loadOptionsDependsOn: ['tableName.value'],
};

/** Entries valid on any read: which fields come back and how they are expanded. */
const SELECTOR_OPTIONS: INodeProperties[] = [
  {
    displayName: 'Fields',
    name: 'fields',
    type: 'multiOptions',
    typeOptions: FIELD_DROPDOWN,
    default: [],
    description: 'Fields to return. Leave empty for the API default (every field).',
  },
  {
    displayName: 'Display Value Fields',
    name: 'displayValues',
    type: 'multiOptions',
    typeOptions: FIELD_DROPDOWN,
    default: [],
    description: 'Reference fields to return as {value, displayValue} objects',
  },
  {
    displayName: 'Relation Fields',
    name: 'relations',
    type: 'string',
    default: '',
    placeholder: 'Requestor.Name,Requestor.Manager.Name',
    description:
      "Comma-separated dot-walked relation fields to expand. Stays a typed list: the registry holds one table's own fields, and a relation path walks through other tables.",
  },
];

/** Entries that only make sense for a list read: the raw query and the sort order. */
const LIST_ONLY_OPTIONS: INodeProperties[] = [
  {
    displayName: 'Query (JSON)',
    name: 'query',
    type: 'json',
    default: '',
    description: 'Advanced complex query as JSON, e.g. {"and":[{"fieldName":"Closed","operator":"=","value":false}]}. Takes precedence over Filters when set. See https://docs-servicely.atlassian.net/wiki/spaces/SD/pages/2077523978.',
  },
  {
    displayName: 'Sort Field',
    name: 'sortField',
    type: 'options',
    typeOptions: FIELD_DROPDOWN,
    default: '',
    description: 'Field to sort by',
  },
  {
    displayName: 'Sort Descending',
    name: 'sortDescending',
    type: 'boolean',
    default: false,
    description: 'Whether to sort in descending order',
  },
];

/** The Options collection for a single-record read. */
export const selectorOptionsProperty: INodeProperties = {
  displayName: 'Options',
  name: 'options',
  type: 'collection',
  placeholder: 'Add Option',
  default: {},
  options: SELECTOR_OPTIONS,
};

/** The Options collection for a list read: selectors plus query and sort. */
export const listOptionsProperty: INodeProperties = {
  displayName: 'Options',
  name: 'options',
  type: 'collection',
  placeholder: 'Add Option',
  default: {},
  options: [...SELECTOR_OPTIONS, ...LIST_ONLY_OPTIONS],
};

/** Max number of results to return, paired with a Return All toggle. */
export const limitProperty: INodeProperties = {
  displayName: 'Limit',
  name: 'limit',
  type: 'number',
  typeOptions: { minValue: 1 },
  default: 50,
  description: 'Max number of results to return',
};

// ---------------------------------------------------------------------------
// Request options
// ---------------------------------------------------------------------------

/**
 * Request-level options shared by every operation and by the trigger. These map
 * to the transport's resilience config rather than to any API query parameter.
 */
export const requestOptionsProperty: INodeProperties = {
  displayName: 'Request Options',
  name: 'requestOptions',
  type: 'collection',
  placeholder: 'Add Option',
  default: {},
  options: [
    {
      displayName: 'Timeout (Ms)',
      name: 'timeout',
      type: 'number',
      typeOptions: { minValue: 1 },
      default: DEFAULT_TIMEOUT_MS,
      description: 'How long to wait for a response before aborting the request',
    },
    {
      displayName: 'Max Retries',
      name: 'maxRetries',
      type: 'number',
      typeOptions: { minValue: 0 },
      default: DEFAULT_MAX_RETRIES,
      description: 'How many times to retry on rate limits (429), server errors (5xx), and network failures. Set 0 to disable retries.',
    },
  ],
};
