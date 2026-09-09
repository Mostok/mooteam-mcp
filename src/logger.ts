const levels = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
export type LogLevel = keyof typeof levels;

export function createLogger(level: LogLevel = 'info') {
  return (severity: Exclude<LogLevel, 'silent'>, event: string, data: Record<string, string | number | boolean | undefined> = {}) => {
    if (levels[severity] < levels[level]) return;
    // Callers supply operational metadata only. Never log response bodies, URLs with queries or credentials.
    process.stderr.write(JSON.stringify({ time: new Date().toISOString(), level: severity, event, ...data }) + '\n');
  };
}
export type Logger = ReturnType<typeof createLogger>;
