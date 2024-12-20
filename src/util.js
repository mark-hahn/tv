export function fmtDate(dateStr = null) {
  const date = dateStr ? new Date(dateStr) : new Date();
  return date.toISOString().slice(5,10).replace(/^0/,' ');
}
