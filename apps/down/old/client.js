// Browser sample usage (run in DevTools console)
//
// If you're calling from another host, replace localhost with the server hostname/IP.
// Example:
//   startProc()

async function startProc() {
  const url = new URL('http://localhost:3003/startProc');

  const res = await fetch(url.toString(), {
    method: 'GET',
    mode: 'cors',
  });

  return await res.json();
}

// Example:
// startProc().then(console.log).catch(console.error);
