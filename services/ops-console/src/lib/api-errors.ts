import { copy } from '@/copy/copy';

export class SessionExpiredError extends Error {
  constructor() {
    super(copy.sessionExpired);
    this.name = 'SessionExpiredError';
  }
}

/** A write the hub turned down, with the code a page may branch on. */
export class ApiRefusal extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'ApiRefusal';
  }
}

/**
 * The hub did not answer a read: our 15 s timeout, a request that never left
 * the browser, or a 5xx (from the Worker or from the edge in front of it). The
 * message is already the operator's words, so a page may print it as is.
 */
export class BackendUnreachableError extends Error {
  constructor(
    readonly kind: 'timeout' | 'network' | 'server',
    message: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'BackendUnreachableError';
  }
}
