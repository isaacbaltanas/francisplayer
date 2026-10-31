import { app, net, protocol } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { requiresPreviewProxy } from './mediaUrl.js';

const pendingProxies = new Map<string, Promise<string>>();

const createPreviewProxy = (filePath: string, ffmpegPath: string) => {
  const stat = fs.statSync(filePath);
  const cacheKey = crypto.createHash('sha256').update(`${filePath}:${stat.size}:${stat.mtimeMs}`).digest('hex');
  const cacheDirectory = path.join(app.getPath('temp'), 'francis-player-previews');
  const outputPath = path.join(cacheDirectory, `${cacheKey}.mp3`);
  if (fs.existsSync(outputPath)) return Promise.resolve(outputPath);
  const current = pendingProxies.get(cacheKey);
  if (current) return current;
  fs.mkdirSync(cacheDirectory, { recursive: true });
  const task = new Promise<string>((resolve, reject) => {
    const process = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', filePath, '-vn', '-codec:a', 'libmp3lame',
      '-b:a', '192k', '-y', outputPath], { windowsHide: true });
    let detail = '';
    process.stderr.on('data', chunk => { detail += chunk.toString(); });
    process.once('error', reject);
    process.once('exit', code => code === 0 ? resolve(outputPath) : reject(new Error(detail || `FFmpeg exit ${code}`)));
  }).finally(() => pendingProxies.delete(cacheKey));
  pendingProxies.set(cacheKey, task);
  return task;
};

export const registerMediaProtocol = (ffmpegPath: string | null) => {
  protocol.handle('francis-media', async request => {
    const url = new URL(request.url);
    const filePath = url.searchParams.get('path');
    if (!filePath) return new Response('Missing media path', { status: 400 });
    try {
      const playablePath = (url.searchParams.get('proxy') === '1' || requiresPreviewProxy(filePath)) && ffmpegPath
        ? await createPreviewProxy(filePath, ffmpegPath) : filePath;
      const response = await net.fetch(pathToFileURL(playablePath).href);
      const headers = new Headers(response.headers);
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Access-Control-Allow-Headers', 'Range');
      headers.set('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Length, Content-Range');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch (error) {
      return new Response(error instanceof Error ? error.message : 'Unable to prepare audio preview', { status: 500 });
    }
  });
};
