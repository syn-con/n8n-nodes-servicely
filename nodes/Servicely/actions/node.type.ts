import type { AllEntities } from 'n8n-workflow';

/** Every resource of the Servicely node mapped to the operations it supports. */
type ServicelyMap = {
  object: 'create' | 'delete' | 'get' | 'getAll' | 'update';
  attachment: 'download' | 'list' | 'upload';
  queue: 'replyFailure' | 'replySuccess';
};

/**
 * Discriminated union of every valid resource/operation pair. The router narrows
 * on it, so adding an operation to a resource folder without registering it here
 * is a compile error rather than a runtime "unsupported operation".
 */
export type Servicely = AllEntities<ServicelyMap>;
