// Embute os arquivos de public/ no Worker (gera src/static.ts), sem depender do upload de assets.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/manifest+json', svg: 'image/svg+xml' };
const files = {};
for (const f of readdirSync('public')) {
  const ext = f.split('.').pop();
  if (!TYPES[ext]) throw new Error('Tipo não suportado em public/: ' + f);
  files['/' + f] = { type: TYPES[ext], body: readFileSync('public/' + f, 'utf8') };
}
writeFileSync('src/static.ts', `// ARQUIVO GERADO por scripts/build-static.mjs — não edite.\nexport const STATIC: Record<string, { type: string; body: string }> = ${JSON.stringify(files)};\n`);
console.log('static.ts:', Object.keys(files).join(', '));
