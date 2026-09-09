export class MooTeamError extends Error {
  constructor(public readonly code: string, message: string, public readonly status?: number) {
    super(message);
    this.name = 'MooTeamError';
  }
}

export function publicError(error: unknown): { code: string; message: string } {
  if (error instanceof MooTeamError) return { code: error.code, message: error.message };
  return { code: 'INTERNAL_ERROR', message: 'The operation failed. Check the local stderr log for the error category.' };
}
