import { defineConfig, type Plugin } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Dev-only: lets lab/wallet.html save review renders (PNG) into .img2threejs/renders for the
// img2threejs review gates. Names are sanitised; nothing else on disk is writable.
function reviewCapture(): Plugin {
  const outDir = resolve(import.meta.dirname, '.img2threejs/renders');
  return {
    name: 'review-capture',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__capture', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const name = new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? '';
        if (!/^[a-z0-9-]{1,64}$/.test(name)) {
          res.statusCode = 400;
          res.end('bad name');
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const b64 = Buffer.concat(chunks).toString('utf8').replace(/^data:image\/png;base64,/, '');
          mkdirSync(outDir, { recursive: true });
          writeFileSync(resolve(outDir, `${name}.png`), Buffer.from(b64, 'base64'));
          res.end('ok');
        });
      });
    },
  };
}

// 5173 is DeanFi2's dev server; DeanFi3 gets its own port.
export default defineConfig({
  plugins: [reviewCapture()],
  server: { port: 5180, strictPort: true },
  preview: { port: 5181, strictPort: true },
});
