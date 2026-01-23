export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function formatYyyyMmDd_HhMmSs(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const yyyy = String(d.getFullYear()).padStart(4, '0');
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return { yyyy, mm, dd, hh, mi, ss, stamp: `${dd}_${hh}:${mi}:${ss}` };
}

export function elapsedSecsSince(startMs) {
  return Math.max(0, Math.floor((Date.now() - startMs) / 1000));
}
