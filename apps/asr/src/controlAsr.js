import { getManager } from './state.js';

export async function controlAsrHandler(req, res) {
  try {
    const mgr = getManager();
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = await mgr.controlAsr(body);
    res.json(result);
  } catch (err) {
    res.status(500).json({
      asrId: null,
      filePath: null,
      status: 'error',
      numFilesFinished: 0,
      numFilesTotal: 0,
      started: null,
      elapsedSecs: 0,
      progressFile: 0,
      progressAll: 0,
      estRemainingSecs: 0,
      log: '',
      error: err?.message ? String(err.message) : String(err),
    });
  }
}
