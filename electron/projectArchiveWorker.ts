import { parentPort } from 'node:worker_threads';
import fs from 'node:fs';
import { writeProjectArchive } from './projectArchive.js';

parentPort?.on('message', ({ payload, projectPath }: { payload: any; projectPath: string }) => {
  const temporaryPath = `${projectPath}.saving-${process.pid}`;
  const backupPath = `${projectPath}.previous-${process.pid}`;
  try {
    writeProjectArchive(payload, temporaryPath, (completed, total) => parentPort?.postMessage({ type: 'progress', completed, total }));
    if (fs.existsSync(projectPath)) fs.renameSync(projectPath, backupPath);
    fs.renameSync(temporaryPath, projectPath);
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
    parentPort?.postMessage({ type: 'complete', ok: true });
  } catch (error) {
    try { if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath); } catch { /* Best-effort cleanup. */ }
    try { if (fs.existsSync(backupPath) && !fs.existsSync(projectPath)) fs.renameSync(backupPath, projectPath); } catch { /* Keep backup for recovery. */ }
    parentPort?.postMessage({ type: 'complete', ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
