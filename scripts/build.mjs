#!/usr/bin/env node
import { build } from 'esbuild';
import { execSync } from 'child_process';
import { writeFileSync, copyFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');

console.log('[0] Patching ink reconciler...');
execSync(
  `node -e "const f=require('fs'); let c=f.readFileSync('node_modules/ink/build/reconciler.js','utf8'); c=c.replace(/if \\\\(process\\\\.env\\\\['DEV'\\\\] === 'true'\\\\) \\\\{[\\\\s\\\\S]*?\\\\n\\\\}/m, '// DEV block removed\\\\n'); f.writeFileSync('node_modules/ink/build/reconciler.js', c);"`,
  { cwd: ROOT, stdio: 'inherit' }
);

mkdirSync(DIST, { recursive: true });

// === Build API .exe ===
console.log('[1] Building api.exe (fully self-contained)...');

// Extract route handler modules at build time
const modDir = resolve(ROOT, 'KuGouMusicApi', 'module');
const { readdirSync: rd, readFileSync: rf } = await import('fs');
const modFiles = rd(modDir).filter(f => f.endsWith('.js') && !f.startsWith('_')).reverse();

// Build util bundle with axios and qrcode exposed
await build({
  entryPoints: [resolve(ROOT, 'KuGouMusicApi', 'util', 'index.js')],
  bundle: true, platform: 'node', format: 'cjs',
  outfile: resolve(DIST, 'util-bundle.cjs'),
});
let utilBundleCode = readFileSync(resolve(DIST, 'util-bundle.cjs'), 'utf8');

// Also bundle axios and qrcode separately for inline access
await build({
  entryPoints: [resolve(ROOT, 'KuGouMusicApi', 'node_modules', 'axios', 'index.js')],
  bundle: true, platform: 'node', format: 'cjs',
  outfile: resolve(DIST, 'axios-bundle.cjs'),
});
const axiosBundleCode = readFileSync(resolve(DIST, 'axios-bundle.cjs'), 'utf8');

await build({
  entryPoints: [resolve(ROOT, 'KuGouMusicApi', 'node_modules', 'qrcode', 'lib', 'index.js')],
  bundle: true, platform: 'node', format: 'cjs',
  outfile: resolve(DIST, 'qrcode-bundle.cjs'),
});
const qrcodeBundleCode = readFileSync(resolve(DIST, 'qrcode-bundle.cjs'), 'utf8');

// Build the pre-built module registry
let prebuiltCode = '// Pre-built module registry — zero filesystem or dynamic require\n';
prebuiltCode += 'const __bundledUtil = (function() {\n';
prebuiltCode += '  const module = { exports: {} };\n';
prebuiltCode += '  const fn = new Function("module", "exports", "require", ' + JSON.stringify(utilBundleCode) + ');\n';
prebuiltCode += '  fn(module, module.exports, require);\n';
prebuiltCode += '  return module.exports;\n';
prebuiltCode += '})();\n';

// Inline axios and qrcode bundles (self-contained, no require needed)
prebuiltCode += '__bundledUtil.axios = (function() {\n';
prebuiltCode += '  const module = { exports: {} };\n';
prebuiltCode += '  const fn = new Function("module", "exports", "require", ' + JSON.stringify(axiosBundleCode) + ');\n';
prebuiltCode += '  fn(module, module.exports, require);\n';
prebuiltCode += '  return module.exports;\n';
prebuiltCode += '})();\n';

prebuiltCode += '__bundledUtil.qrcode = (function() {\n';
prebuiltCode += '  const module = { exports: {} };\n';
prebuiltCode += '  const fn = new Function("module", "exports", "require", ' + JSON.stringify(qrcodeBundleCode) + ');\n';
prebuiltCode += '  fn(module, module.exports, require);\n';
prebuiltCode += '  return module.exports;\n';
prebuiltCode += '})();\n';
prebuiltCode += 'const __modules = [];\n';

for (const f of modFiles) {
  const identifier = f.replace('.js', '');
  const route = '/' + identifier.replace(/_/g, '/');
  let content = rf(resolve(modDir, f), 'utf8');
  // Replace dynamic require() calls with bundled references
  content = content.replace(/require\(['"]\.\.\/util\/([^'"]+)['"]\)/g, '__bundledUtil["$1"] || __bundledUtil');
  content = content.replace(/require\(['"]\.\.\/util['"]\)/g, '__bundledUtil');
  content = content.replace(/require\(['"]\.\.\/\.\.\/util['"]\)/g, '__bundledUtil');
  content = content.replace(/require\(['"]axios['"]\)/g, '__bundledUtil.axios');
  content = content.replace(/require\(['"]qrcode['"]\)/g, '__bundledUtil.qrcode');
  prebuiltCode += `__modules.push({ identifier: "${identifier}", route: "${route}", handler: (function() {\n`;
  prebuiltCode += `  const module = { exports: {} };\n`;
  prebuiltCode += `  const fn = new Function('module', 'exports', '__bundledUtil', ${JSON.stringify(content)});\n`;
  prebuiltCode += `  fn(module, module.exports, __bundledUtil);\n`;
  prebuiltCode += `  return module.exports;\n`;
  prebuiltCode += `})() });\n`;
}

prebuiltCode += `
async function getModulesDefinitions() {
  return __modules.map(m => ({
    identifier: m.identifier,
    route: m.route,
    module: m.handler,
  }));
}
`;

// Bundle the API server
await build({
  entryPoints: [resolve(ROOT, 'KuGouMusicApi', 'app.js')],
  bundle: true, platform: 'node', format: 'cjs',
  outfile: resolve(DIST, 'api.cjs'),
  external: ['../util', '../util/*', '../../util', '../../util/*', './module/*'],
});

let apiCode = readFileSync(resolve(DIST, 'api.cjs'), 'utf8').replace(/^#!.*\n/, '');

// Replace getModulesDefinitions with pre-built version
const fnHeader = 'async function getModulesDefinitions(';
const fnStart = apiCode.indexOf(fnHeader);
if (fnStart > 0) {
  let depth = 0, fnEnd = fnStart;
  for (let i = fnStart; i < apiCode.length; i++) {
    if (apiCode[i] === '{') depth++;
    if (apiCode[i] === '}') { depth--; if (depth === 0) { fnEnd = i + 1; break; } }
  }
  apiCode = apiCode.slice(0, fnStart) + prebuiltCode + apiCode.slice(fnEnd);
}

writeFileSync(resolve(DIST, 'api.cjs'), apiCode);

// Copy public/ for static serving (accessed via fs, not require)
execSync(`node -e "require('fs').cpSync('KuGouMusicApi/public', 'dist/public', {recursive: true})"`, { cwd: ROOT, stdio: 'inherit' });

// API SEA
writeFileSync(resolve(DIST, 'api-sea-config.json'), JSON.stringify({
  main: 'dist/api.cjs',
  output: 'dist/api-blob.bin',
  disableExperimentalSEAWarning: true,
}));
execSync('node --experimental-sea-config dist/api-sea-config.json', { cwd: ROOT, stdio: 'inherit' });
copyFileSync(process.execPath, resolve(DIST, 'api.exe'));
execSync('npx postject dist/api.exe NODE_SEA_BLOB dist/api-blob.bin --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', { cwd: ROOT, stdio: 'inherit' });

// === Build TUI .exe ===
console.log('[2] Building download.exe...');
await build({
  entryPoints: [resolve(ROOT, 'download.js')],
  bundle: true, platform: 'node', format: 'cjs',
  outfile: resolve(DIST, 'bundle.cjs'),
  external: ['react-devtools-core'],
  plugins: [{
    name: 'yoga-alias',
    setup(b) {
      b.onResolve({ filter: /^yoga-layout$/ }, () => ({
        path: resolve(ROOT, 'lib', 'yoga-shim.cjs'),
      }));
    },
  }],
});

writeFileSync(resolve(DIST, 'sea-config.json'), JSON.stringify({
  main: 'dist/bundle.cjs',
  output: 'dist/sea-prep.blob',
  disableExperimentalSEAWarning: true,
}));
execSync('node --experimental-sea-config dist/sea-config.json', { cwd: ROOT, stdio: 'inherit' });
copyFileSync(process.execPath, resolve(DIST, 'download.exe'));
execSync('npx postject dist/download.exe NODE_SEA_BLOB dist/sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', { cwd: ROOT, stdio: 'inherit' });

// Clean temp files
for (const f of ['api.cjs', 'bundle.cjs', 'api-blob.bin', 'sea-prep.blob', 'api-sea-config.json', 'sea-config.json']) {
  try { (await import('fs')).unlinkSync(resolve(DIST, f)); } catch {}
}

console.log('');
console.log('BUILD COMPLETE:');
console.log('  dist/download.exe  — TUI downloader');
console.log('  dist/api.exe       — API server (auto-launched by download.exe)');
console.log('');
console.log('Distribute the entire dist/ folder, or just the two .exe files together.');

function mkDirRecursive(p) {
  try { mkdirSync(p, { recursive: true }); } catch {}
}
