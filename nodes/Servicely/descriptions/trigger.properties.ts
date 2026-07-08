import type { INodeProperties } from 'n8n-workflow';

import { DEFAULT_DEQUEUE_COUNT } from '../constants';
import { filtersProperty } from './filters';
import { tableResourceLocator } from './resourceLocators';

const showForQueue = { triggerOn: ['queue'] };
const showForObject = { triggerOn: ['object'] };

/**
 * Properties for the Servicely Trigger node. `triggerOn` selects between
 * dequeuing async-queue messages and polling a table by filter; the rest of
 * the fields show/hide off that switch.
 */
export const triggerProperties: INodeProperties[] = [
  {
    displayName: 'Trigger On',
    name: 'triggerOn',
    type: 'options',
    noDataExpression: true,
    options: [
      {
        name: 'Async Queue Message',
        value: 'queue',
        description: 'Dequeue messages from a Servicely Async Integration queue',
      },
      {
        name: 'Object (Table Records)',
        value: 'object',
        description: 'Poll a table for records matching a filter',
      },
    ],
    default: 'queue',
  },

  // --- Async Queue --------------------------------------------------------
  {
    displayName: 'Queue',
    name: 'queue',
    type: 'string',
    default: '',
    required: true,
    placeholder: 'my-integration-queue',
    description: 'Name of the Async Integration queue to claim messages from',
    displayOptions: { show: showForQueue },
  },
  {
    displayName: 'Action Name',
    name: 'subject',
    type: 'string',
    default: '',
    required: true,
    placeholder: 'process-incident',
    description: 'The action/subject identifying which messages to claim (the queue "subject")',
    displayOptions: { show: showForQueue },
  },
  {
    displayName: 'Messages Per Poll',
    name: 'requestCount',
    type: 'number',
    typeOptions: { minValue: 1 },
    default: DEFAULT_DEQUEUE_COUNT,
    description: 'Maximum number of messages to claim on each poll',
    displayOptions: { show: showForQueue },
  },

  // --- Object (table records) --------------------------------------------
  tableResourceLocator({
    name: 'tableName',
    displayName: 'Table',
    description: 'Servicely table to poll (e.g. Incident, ITSMRequest, User, Group)',
    displayOptions: { show: showForObject },
    default: 'Incident',
  }),
  {
    displayName: 'Limit',
    name: 'limit',
    type: 'number',
    typeOptions: { minValue: 1 },
    default: 50,
    description: 'Max number of records to return on each poll',
    displayOptions: { show: showForObject },
  },
  filtersProperty({ show: showForObject }),
  {
    displayName: 'Options',
    name: 'options',
    type: 'collection',
    placeholder: 'Add Option',
    default: {},
    displayOptions: { show: showForObject },
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
        description: 'Advanced complex query as JSON, e.g. {"and":[{"fieldName":"Closed","operator":"=","value":false}]}. Takes precedence over Filters when set.',
      },
      {
        displayName: 'Sort Field',
        name: 'sortField',
        type: 'string',
        default: '',
        placeholder: 'CreatedOn',
        description: 'Field to sort by',
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
