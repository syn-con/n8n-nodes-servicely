import type { INodeProperties } from 'n8n-workflow';

import { DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS } from '../constants';

/**
 * Request-level options shared by every resource/operation. These map to the
 * transport layer's resilience config (timeout + retry budget) rather than to
 * any API query parameter.
 */
export const commonProperties: INodeProperties[] = [
  {
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
  },
];
