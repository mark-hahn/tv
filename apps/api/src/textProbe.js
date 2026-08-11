// Decide whether a byte buffer looks like text. An ascii-only test is not
// enough: .nfo files are usually utf-8 box-drawing art, which is all
// high bytes.

// buffers may be cut mid-character, so allow a few bad chars
const MAX_BAD_FRACTION = 0.1;

export function isTextBuffer(buf) {
  if (buf.length === 0) return true;
  if (buf.includes(0)) return false;
  const text = new TextDecoder("utf-8").decode(buf);
  if (text.length === 0) return false;
  let bad = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c === 9 || c === 10 || c === 13) continue;
    // C0/C1 controls, delete, and utf-8 decode failures
    if (c < 0x20 || c === 0x7f || c === 0xfffd) bad++;
  }
  return bad / text.length <= MAX_BAD_FRACTION;
}
