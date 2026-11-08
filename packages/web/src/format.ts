export const shortHash = (value: string, head = 6, tail = 4) => (value.length <= head + tail + 2 ? value : `${value.slice(0, head + 2)}...${value.slice(-tail)}`);

export function relativeTime(unix: number, now = Date.now() / 1000): string {
  const s = Math.round(now - unix);
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(unix * 1000).toLocaleDateString();
}

export function duration(seconds: number): string {
  if (seconds < 1) return '<1 s';
  if (seconds < 90) return `${Math.round(seconds)} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

export const dateTime = (unix: number) => new Date(unix * 1000).toLocaleString();

export const kib = (bytes: number) => `${(bytes / 1024).toFixed(1)} KiB`;
