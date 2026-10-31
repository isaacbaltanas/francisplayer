import { net, protocol } from 'electron';
import { pathToFileURL } from 'node:url';

export const registerMediaProtocol = () => {
  protocol.handle('francis-media', request => {
    const filePath = new URL(request.url).searchParams.get('path');
    if (!filePath) return new Response('Missing media path', { status: 400 });
    return net.fetch(pathToFileURL(filePath).href);
  });
};
