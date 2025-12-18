# tv-proc
Download videos from USB and insert into tv folder

## Running continuously (pm2)

This app is designed to run continuously and re-scan/process every 5 minutes.

- Compile CoffeeScript (optional; pm2 runs the compiled JS): `coffee -c main.coffee`
- Start with pm2: `pm2 start main.js --name tv-proc`
- For testing, edit `FAST_TEST` in `main.coffee` (then recompile)
