import type { IDisplayOptions, INodeProperties, INodePropertyOptions } from 'n8n-workflow';

import { QUERY_OPERATORS } from '../constants';

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

/** `options`-ready operator choices, shared by every filter builder. */
export const operatorOptions: INodePropertyOptions[] = QUERY_OPERATORS.map((op) => ({
  name: OPERATOR_LABELS[op] ?? op,
  value: op,
}));

/**
 * The simple-mode AND filter fixedCollection, shared by the Object resource's
 * Get Many operation and the trigger's Object mode so both offer an identical
 * builder (DRY). Callers supply their own `displayOptions`.
 */
export function filtersProperty(displayOptions: IDisplayOptions): INodeProperties {
  return {
    displayName: 'Filters',
    name: 'filters',
    type: 'fixedCollection',
    typeOptions: { multipleValues: true },
    default: {},
    placeholder: 'Add Condition',
    description: 'Simple conditions combined with AND. For OR/NOR or nested logic, use the raw Query (JSON) option instead.',
    displayOptions,
    options: [
      {
        name: 'conditions',
        displayName: 'Condition',
        values: [
          {
            displayName: 'Field Name',
            name: 'fieldName',
            type: 'string',
            default: '',
            placeholder: 'State',
            description: 'Field to filter on. Dot-walk relations are allowed (e.g. Requestor.Email).',
          },
          {
            displayName: 'Operator',
            name: 'operator',
            type: 'options',
            options: operatorOptions,
            default: '=',
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
}
