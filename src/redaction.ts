export function isSensitiveQueryKey(key: string): boolean {
  try { key = decodeURIComponent(key); } catch { /* Keep literal malformed keys. */ }
  return /^(token|access_token|authorization|api_key|key|signature|sig)$/i.test(key) || /^x-(?:amz|goog)-/i.test(key);
}

export function redactText(text: string, secrets: (string | undefined)[] = []): string {
  for (const secret of secrets) if (secret) text = text.split(secret).join('[REDACTED]');
  return text.replace(/([?&]([^=&\s]+)=)([^&\s"'<>\\)]*)/g, (match, prefix: string, key: string) => isSensitiveQueryKey(key) ? prefix + '[REDACTED]' : match);
}
