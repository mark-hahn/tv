import fs from 'fs';
import path from 'node:path';

export function createFileLogger(logPath) {
  const dir = path.dirname(logPath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }

  function toLine(args) {
    return args
      .map((a) => {
        if (typeof a === 'string') return a;
        if (a instanceof Error) return a.stack || a.message || String(a);
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(' ');
  }

  function append(line) {
    try {
      fs.appendFileSync(logPath, line + '\n', 'utf8');
    } catch {
      // ignore
    }
  }

  return {
    log: (...args) => append(toLine(args)),
    error: (...args) => append(toLine(args)),
  };
}
