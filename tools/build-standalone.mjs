// Builds Red_Rift.html: one self-contained file (game code, three.js, CSS, fonts) that opens from disk offline.
// Usage: npm run build
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = (p, enc = 'utf8') => readFileSync(join(root, p), enc);

const js = await build({
  entryPoints: [join(root, 'js/main.js')],
  bundle: true, minify: true, format: 'iife', target: 'es2020', write: false, legalComments: 'none',
  // index.html maps "three/addons/" to examples/jsm; the npm package exposes the same files under "three/addons/*"
});
const code = js.outputFiles[0].text;

// fonts: cyrillic + latin subsets, embedded as base64
const fonts = [
  ['Russo One', 'russo-one', 'russo-one', [400]],
  ['Exo 2', 'exo-2', 'exo-2', [400, 600, 800]],
  ['JetBrains Mono', 'jetbrains-mono', 'jetbrains-mono', [500, 700]],
];
let fontCss = '';
for (const [family, pkg, file, weights] of fonts) {
  for (const w of weights) for (const subset of ['cyrillic', 'latin']) {
    const b64 = rd(`node_modules/@fontsource/${pkg}/files/${file}-${subset}-${w}-normal.woff2`, null).toString('base64');
    fontCss += `@font-face{font-family:'${family}';font-style:normal;font-weight:${w};font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2')}\n`;
  }
}

let html = rd('index.html');
const cut = (re, repl) => { if (!re.test(html)) throw new Error('pattern not found: ' + re); html = html.replace(re, repl); };
cut(/\s*<link rel="preconnect"[^>]*>/g, '');
cut(/\s*<link href="https:\/\/fonts\.googleapis\.com[^>]*>/, '');
cut(/<link rel="stylesheet" href="style\.css">/, () => `<style>\n${fontCss}${rd('style.css')}</style>`);
cut(/<script type="importmap">[\s\S]*?<\/script>/, '');
// the offline file has no separate download link to itself
cut(/\s*<p class="small"><a href="Red_Rift\.html"[^\n]*<\/p>/, '');
// ship models (GLB) embedded as base64; js/ships.js reads window.__RR_MODELS before fetching
const models = Object.fromEntries(['kestrel', 'mirage', 'bastion', 'arc', 'nomad'].map(k => [k, rd(`models/${k}.glb`, null).toString('base64')]));
const modelScript = `<script>window.__RR_MODELS=${JSON.stringify(models)};</script>\n`;
// "</script" inside the bundle would close the tag early
cut(/<script type="module" src="js\/main\.js"><\/script>/, () => `${modelScript}<script>\n${code.replace(/<\/script/gi, '<\\/script')}</script>`);

if (/https?:\/\/(?!www\.w3\.org)[^"'\s)]+\.(js|css|woff2?|png|jpe?g|webp|glb)/i.test(html)) throw new Error('external resource left in the standalone build');
writeFileSync(join(root, 'Red_Rift.html'), html);
console.log(`Red_Rift.html: ${(html.length / 1024).toFixed(0)} KB`);
