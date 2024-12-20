export function fmtDate(dateStr = '') {
  return new Date(dateStr)
            .toISOString().slice(5,10)
            .replace(/^0/,' ');
}
