import type { INodeProperties } from 'n8n-workflow';

import { QUERY_OPERATORS } from '../constants';
import { recordResourceLocator, tableResourceLocator } from './resourceLocators';

const showForObject = { resource: ['object'] };

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

const operatorOptions = QUERY_OPERATORS.map((op) => ({ name: OPERATOR_LABELS[op] ?? op, value: op }));

/** Properties for the Object resource (CRUD over any Servicely table). */
export const objectProperties: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: showForObject },
    options: [
      { name: 'Create', value: 'create', action: 'Create a record', description: 'Create a new record (POST)' },
      { name: 'Delete', value: 'delete', action: 'Delete a record', description: 'Delete a record by ID (DELETE)' },
      { name: 'Get', value: 'get', action: 'Get a record', description: 'Retrieve a single record by ID (GET)' },
      { name: 'Get Many', value: 'getAll', action: 'Get many records', description: 'Retrieve a list of records (GET)' },
      { name: 'Update', value: 'update', action: 'Update a record', description: 'Update fields on a record (PATCH)' },
    ],
    default: 'getAll',
  },
  tableResourceLocator({
    name: 'tableName',
    displayName: 'Table',
    description: 'Servicely table to operate on (e.g. Incident, ITSMRequest, User, Group)',
    displayOptions: { show: showForObject },
    default: 'Incident',
  }),
  recordResourceLocator({
    name: 'recordId',
    displayName: 'Record',
    description: 'The record to operate on',
    searchListMethod: 'searchObjectRecords',
    displayOptions: { show: { ...showForObject, operation: ['get', 'update', 'delete'] } },
  }),
  {
    displayName: 'Return All',
    name: 'returnAll',
    type: 'boolean',
    default: false,
    description: 'Whether to return all results by paging through them, or only up to a given limit',
    displayOptions: { show: { ...showForObject, operation: ['getAll'] } },
  },
  {
    displayName: 'Limit',
    name: 'limit',
    type: 'number',
    typeOptions: { minValue: 1 },
    default: 50,
    description: 'Max number of results to return',
    displayOptions: { show: { ...showForObject, operation: ['getAll'], returnAll: [false] } },
  },
  {
    displayName: 'Filters',
    name: 'filters',
    type: 'fixedCollection',
    typeOptions: { multipleValues: true },
    default: {},
    placeholder: 'Add Condition',
    description: 'Simple conditions combined with AND. For OR/NOR or nested logic, use the raw Query (JSON) option instead.',
    displayOptions: { show: { ...showForObject, operation: ['getAll'] } },
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
  },
  {
    displayName: 'Fields to Set',
    name: 'fieldsToSet',
    type: 'fixedCollection',
    typeOptions: { multipleValues: true },
    default: {},
    placeholder: 'Add Field',
    description: 'The record fields to write',
    displayOptions: { show: { ...showForObject, operation: ['create', 'update'] } },
    options: [
      {
        name: 'field',
        displayName: 'Field',
        values: [
          {
            displayName: 'Field Name',
            name: 'name',
            type: 'string',
            default: '',
            placeholder: 'ShortDescription',
            description: 'Name of the Servicely field',
          },
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
  },
  {
    displayName: 'Options',
    name: 'options',
    type: 'collection',
    placeholder: 'Add Option',
    default: {},
    displayOptions: { show: { ...showForObject, operation: ['get', 'getAll'] } },
    options: [
      {
        displayName: 'Fields',
        name: 'fields',
        type: 'string',
        default: '',
        placeholder: 'id,Number,ShortDescription',
        description: 'Comma-separated list of fields to return',
      },
      {
        displayName: 'Display Value Fields',
        name: 'displayValues',
        type: 'string',
        default: '',
        placeholder: 'AssignmentGroup,Requestor',
        description: 'Comma-separated fields to return as {value, displayValue} objects',
      },
      {
        displayName: 'Relation Fields',
        name: 'relations',
        type: 'string',
        default: '',
        placeholder: 'Requestor.Name,Requestor.Manager.Name',
        description: 'Comma-separated dot-walked relation fields to expand',
      },
      {
        displayName: 'Query (JSON)',
        name: 'query',
        type: 'json',
        default: '',
        description: 'Advanced complex query as JSON, e.g. {"and":[{"fieldName":"Closed","operator":"=","value":false}]}. Takes precedence over Filters when set. See https://docs-servicely.atlassian.net/wiki/spaces/SD/pages/2077523978. Get Many only.',
      },
      {
        displayName: 'Sort Field',
        name: 'sortField',
        type: 'string',
        default: '',
        placeholder: 'CreatedOn',
        description: 'Field to sort by. Get Many only.',
      },
      {
        displayName: 'Sort Descending',
        name: 'sortDescending',
        type: 'boolean',
        default: false,
        description: 'Whether to sort in descending order',
      },
    ],
  },
];
