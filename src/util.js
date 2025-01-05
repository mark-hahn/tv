export function fmtDate(dateStr, includeYear = true) {
  if(!dateStr) return "";
  const date     = dateStr ? new Date(dateStr) : new Date();
  const startIdx = includeYear ? 0 : 5;
  return date.toISOString().slice(startIdx,10).replace(/^0/,' ');
}

export function fmtSize(show) {
  if(show.Id.startsWith("noemby-")) return "";
  const size = show.Size;
  if (size < 1e3) return size;
  if (size < 1e6) return Math.round(size / 1e3) + "K";
  if (size < 1e9) return Math.round(size / 1e6) + "M";
                  return Math.round(size / 1e9) + "G";
}

