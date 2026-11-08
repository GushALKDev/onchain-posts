/**
 * Structured logging that never prints request bodies, and redacts anything shaped like an address or a signature
 * from messages (ADR-016): an address recovered while verifying a request must not reach logs or traces.
 */
const SIGNATURE = /0x[0-9a-fA-F]{130}\b/g;
const ADDRESS = /0x[0-9a-fA-F]{40}\b/g;

export function redact(text: string): string {
  return text.replace(SIGNATURE, '0x[signature]').replace(ADDRESS, '0x[address]');
}

type Fields = Record<string, string | number | boolean | null | undefined>;

function emit(level: 'info' | 'warn' | 'error', message: string, fields: Fields = {}) {
  const safe = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, typeof v === 'string' ? redact(v) : v]));
  const line = JSON.stringify({ level, time: new Date().toISOString(), message: redact(message), ...safe });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const log = {
  info: (message: string, fields?: Fields) => emit('info', message, fields),
  warn: (message: string, fields?: Fields) => emit('warn', message, fields),
  error: (message: string, fields?: Fields) => emit('error', message, fields),
};
