import { app, protocol } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { requiresPreviewProxy } from './mediaUrl.js';

const pendingProxies = new Map<string, Promise<string>>();
const mediaTypes: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.wave': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.aif': 'audio/aiff', '.aiff': 'audio/aiff', '.wma': 'audio/x-ms-wma'
};

const createPreviewProxy = (filePath: string, ffmpegPath: string) => {
  const stat = fs.statSync(filePath);
  const cacheKey = crypto.createHash('sha256').update(`${filePath}:${stat.size}:${stat.mtimeMs}`).digest('hex');
  const cacheDirectory = path.join(app.getPath('temp'), 'francis-player-previews');
  const outputPath = path.join(cacheDirectory, `${cacheKey}.m4a`);
  if (fs.existsSync(outputPath)) return Promise.resolve(outputPath);
  const current = pendingProxies.get(cacheKey);
  if (current) return current;
  fs.mkdirSync(cacheDirectory, { recursive: true });
  const task = new Promise<string>((resolve, reject) => {
    const process = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', filePath, '-vn', '-codec:a', 'aac',
      '-b:a', '192k', '-movflags', '+faststart', '-y', outputPath], { windowsHide: true });
    let detail = '';
    process.stderr.on('data', chunk => { detail += chunk.toString(); });
    process.once('error', reject);
    process.once('exit', code => code === 0 ? resolve(outputPath) : reject(new Error(detail || `FFmpeg exit ${code}`)));
  }).finally(() => pendingProxies.delete(cacheKey));
  pendingProxies.set(cacheKey, task);
  return task;
};

export const preparePreviewProxy = (filePath: string, ffmpegPath: string | null) => (
  requiresPreviewProxy(filePath) && ffmpegPath ? createPreviewProxy(filePath, ffmpegPath) : Promise.resolve(filePath)
);

export const registerMediaProtocol = (ffmpegPath: string | null) => {
  protocol.handle('francis-media', async request => {
    const url = new URL(request.url);
    const filePath = url.searchParams.get('path');
    if (!filePath) return new Response('Missing media path', { status: 400 });
    try {
      const playablePath = url.searchParams.get('proxy') === '1' && ffmpegPath
        ? await createPreviewProxy(filePath, ffmpegPath) : await preparePreviewProxy(filePath, ffmpegPath);
      const stat = await fs.promises.stat(playablePath);
      let start = 0;
      let end = Math.max(0, stat.size - 1);
      let status = 200;
      const range = request.headers.get('range');
      const match = range?.match(/^bytes=(\d*)-(\d*)$/i);
      if (match) {
        if (!match[1] && match[2]) {
          const suffixLength = Math.min(stat.size, Number(match[2]));
          start = stat.size - suffixLength;
        } else {
          start = Number(match[1] || 0);
          if (match[2]) end = Math.min(end, Number(match[2]));
        }
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= stat.size) {
          return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
        }
        status = 206;
      }
      const headers = new Headers({
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
        'Content-Type': mediaTypes[path.extname(playablePath).toLowerCase()] ?? 'application/octet-stream'
      });
      if (status === 206) headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Access-Control-Allow-Headers', 'Range');
      headers.set('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Length, Content-Range');
      if (request.method === 'HEAD') return new Response(null, { status, headers });
      const body = Readable.toWeb(fs.createReadStream(playablePath, { start, end })) as ReadableStream;
      return new Response(body, { status, headers });
    } catch (error) {
      return new Response(error instanceof Error ? error.message : 'Unable to prepare audio preview', { status: 500 });
    }
  });
};
