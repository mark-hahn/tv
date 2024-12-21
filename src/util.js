export function fmtDate(dateStr, includeYear = true) {
  const date     = dateStr ? new Date(dateStr) : new Date();
  const startIdx = includeYear ? 0 : 5;
  return date.toISOString().slice(startIdx,10).replace(/^0/,' ');
}
