// 无额外依赖的真实 DOM 回归：浏览器负责 DOM/MutationObserver，API 与计时器使用夹具。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const candidates = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
const executable = candidates.find(p => fs.existsSync(p));
if (!executable) throw new Error('请安装 Chrome/Chromium，或通过 CHROME_BIN 指定路径');
const root = path.join(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xtags-regression-'));
const original = fs.readFileSync(path.join(root, 'extension/content.js'), 'utf8');
const source = original.replace('function extract(el) {', 'function extract(el) { globalThis.extractCount = (globalThis.extractCount || 0) + 1;')
  .replace('  boot().catch(', '  globalThis.audit = { scan, cacheText, failed, get queue() { return queue; }, get cache() { return cache; }, get inflight() { return inflight; } };\n  globalThis.ready = boot().catch(');
const translations = fs.readFileSync(path.join(root, 'extension/i18n.js'), 'utf8');
const fullTextSource = fs.readFileSync(path.join(root, 'extension/fulltext.js'), 'utf8');
const popupMarkup = fs.readFileSync(path.join(root, 'extension/popup.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const popupCode = fs.readFileSync(path.join(root, 'extension/popup.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
const settingsMarkup = fs.readFileSync(path.join(root, 'extension/settings.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const settingsCode = fs.readFileSync(path.join(root, 'extension/settings.js'), 'utf8');
const serviceCode = fs.readFileSync(path.join(root, 'extension/service.js'), 'utf8');
const fixtures = { serviceCode, translations, fullTextSource, popupMarkup, popupCode, settingsMarkup, settingsCode, manifest };
const html = '<!doctype html><meta charset="utf-8"><body><pre id="results">Running</pre><script>const source=' +
  JSON.stringify(source).replace(/</g, '\\u003c') + ';\nconst fixtures=' + JSON.stringify(fixtures).replace(/</g, '\\u003c') + ';\n' + fs.readFileSync(path.join(__dirname, 'content.browser.js'), 'utf8') + '</script>';
const fixture = path.join(directory, 'test.html'); fs.writeFileSync(fixture, html);
const child = spawn(executable, ['--headless', '--disable-gpu', '--disable-background-networking', '--no-first-run',
  '--no-default-browser-check', `--user-data-dir=${path.join(directory, 'profile')}`, '--dump-dom', '--virtual-time-budget=3000', pathToFileURL(fixture).href]);
let output = '', errors = '', reported = false;
const watchdog = setTimeout(() => { console.error('浏览器测试超时\n' + errors.slice(-2000)); process.exitCode = 1; child.kill('SIGKILL'); }, 30000);
function finish() {
  if (reported) return;
  const encoded = output.match(/data-test-results="([^"]+)"/);
  if (!encoded) return;
  reported = true; clearTimeout(watchdog);
  const results = JSON.parse(decodeURIComponent(encoded[1]));
  for (const result of results) console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}${result.error ? '\n' + result.error : ''}`);
  const passed = results.filter(r => r.ok).length;
  console.log(`${passed}/${results.length} browser regressions passed`);
  process.exitCode = passed === results.length ? 0 : 1;
  fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`Fixtures and results: ${directory}`);
  child.kill('SIGTERM');
  const kill = setTimeout(() => child.kill('SIGKILL'), 2000); kill.unref();
}
child.stdout.on('data', chunk => { output += chunk; finish(); });
child.stderr.on('data', chunk => { errors += chunk; });
child.on('error', error => { clearTimeout(watchdog); console.error(error); process.exitCode = 1; });
child.on('close', () => { clearTimeout(watchdog); if (!reported) { console.error('浏览器未产生测试结果\n' + errors.slice(-2000)); process.exitCode = 1; } });
