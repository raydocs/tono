export class ApiError extends Error {
  reason?: string;

  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
    if (extra && typeof extra.reason === 'string') {
      this.reason = extra.reason;
    }
  }
}
