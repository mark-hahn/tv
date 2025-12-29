// Browser sample usage (run in DevTools console)
//
// If you're calling from another host, replace localhost with the server hostname/IP.
// Example:
//   startProc('Cheers')

async function startProc(title) {
  const url = new URL('http://localhost:3003/startProc');
  if (title) url.searchParams.set('title', title);

  const res = await fetch(url.toString(), {
    method: 'GET',
    mode: 'cors',
  });

  return await res.json();
}

// Example:
// startProc('Cheers').then(console.log).catch(console.error);
