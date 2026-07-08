import {
  searchActions,
  searchAttachments,
  searchObjectRecords,
  searchParentRecords,
  searchQueues,
  searchTables,
} from './listSearch';

/**
 * `methods` block attached to the node. `listSearch` functions back the
 * "From List" mode of every resourceLocator (Table + Record pickers, plus the
 * trigger's Queue + Action Name pickers).
 */
export const nodeMethods = {
  listSearch: {
    searchTables,
    searchObjectRecords,
    searchParentRecords,
    searchAttachments,
    searchQueues,
    searchActions,
  },
};
