
export const jParse = (str, label) => {
  let obj;
  try { obj = JSON.parse(str); }
  catch(e) {
    console.error(`JSON parse error${label ? ' at ' + label : ''}, e.message}`);
    return null;
  }
  return obj;
}