// Builds the single self-contained page.
//   node build.mjs
// Output: index.html (what GitHub Pages serves) and dist/artifact.html (same page without the outer wrapper).
import { build } from 'esbuild';
import fs from 'node:fs';

const res = await build({
  entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', target: ['es2020'],
  loader: { '.json': 'json' }, write: false, legalComments: 'none',
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const page = fs.readFileSync('src/page.html', 'utf8').replace('/*__SCRIPT__*/', () => js);

const cut = page.indexOf('</style>') + '</style>'.length;
const head = page.slice(0, cut), body = page.slice(cut);
const full = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#070b16">
<meta name="description" content="An explorable 3D Bible atlas. Prototype: the Sermon on the Mount.">
${head}
</head>
<body>
${body}
</body>
</html>
`;
fs.writeFileSync('index.html', full);
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/artifact.html', page);
console.log(`index.html ${(full.length / 1024).toFixed(0)} KB`);
