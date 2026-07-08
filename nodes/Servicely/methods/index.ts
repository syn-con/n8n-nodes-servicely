import { searchAttachments, searchObjectRecords, searchParentRecords, searchTables } from './listSearch';

/**
 * `methods` block attached to the node. `listSearch` functions back the
 * "From List" mode of every resourceLocator (Table + Record pickers).
 */
export const nodeMethods = {
  listSearch: {
    searchTables,
    searchObjectRecords,
    searchParentRecords,
    searchAttachments,
  },
};
