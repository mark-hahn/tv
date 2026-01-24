import express from 'express';
import { controlAsrHandler } from './controlAsr.js';

const app = express();

app.use(express.json({ limit: '2mb' }));

// nginx is expected to proxy to https://hahnca.com/asr/controlAsr
app.post(['/controlAsr', '/asr/controlAsr'], controlAsrHandler);

app.get(['/health', '/asr/health'], (req, res) => {
  res.json({ ok: true });
});

const port = 3407;
app.listen(port, () => {
  // Intentionally minimal logging.
  console.log(`@tv/asr listening on port ${port}`);
});
