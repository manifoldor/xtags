const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../extension');
const source = fs.readFileSync(path.join(root, 'i18n.js'), 'utf8');
function setup(systemLanguage, navigatorLanguage = 'en-US') {
  const context = vm.createContext({ chrome: { i18n: { getUILanguage: () => systemLanguage } }, navigator: { language: navigatorLanguage } });
  vm.runInContext(source.replace('globalThis.XtagsI18n =', 'globalThis.catalogs = messages; globalThis.XtagsI18n ='), context);
  return context;
}

test('auto uses Chinese for all Chinese regions and English otherwise', () => {
  for (const lang of ['zh', 'zh-CN', 'zh-SG', 'zh_Hans', 'ZH-cn']) assert.equal(setup(lang).XtagsI18n.resolve('auto'), 'zh');
  for (const lang of ['en', 'en-GB', 'fr-FR', 'ja-JP', 'de']) assert.equal(setup(lang).XtagsI18n.resolve('auto'), 'en');
});

test('manual locale takes priority; invalid stored preferences use auto', () => {
  const { XtagsI18n } = setup('zh-CN');
  const language = XtagsI18n.create('en'); assert.equal(language.t('reset'), 'Pause and clear cache');
  language.setPreference('zh'); assert.equal(language.t('reset'), '暂停并清空缓存');
  language.setPreference('unsupported'); assert.equal(language.preference, 'auto'); assert.equal(language.locale, 'zh');
  assert.equal(XtagsI18n.create().locale, 'zh');
});

test('browser UI locale has priority over page language; navigator is a fallback', () => {
  assert.equal(setup('en-US', 'zh-CN').XtagsI18n.resolve(), 'en');
  assert.equal(setup(undefined, 'zh-CN').XtagsI18n.resolve(), 'zh');
});

test('both catalogs cover the same keys and localize stored error codes', () => {
  const { catalogs, XtagsI18n } = setup('en-US');
  assert.deepEqual(Object.keys(catalogs.en).sort(), Object.keys(catalogs.zh).sort());
  for (const locale of ['en', 'zh']) {
    const language = XtagsI18n.create(locale);
    for (const key of Object.keys(catalogs.en)) assert.ok(language.t(key), `${locale}.${key}`);
    const safe = language.error({ code: 'errorHttp', status: 401, detail: 'Bearer secret-key', message: 'secret-key' });
    assert.ok(safe.includes('401'));
    assert.ok(!safe.includes('secret-key'));
    assert.ok(!language.error('Bearer secret-key').includes('secret-key'));
    assert.notEqual(language.error({ code: 'errorTimeout' }), 'errorTimeout');
    assert.ok(!language.t('errorHttp', { detail: '$& <text>' }).includes('{detail}'));
  }
});

test('manifest loads shared translations first and includes native metadata locales', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.content_scripts[0].js, ['fulltext.js']);
  assert.equal(manifest.content_scripts[0].world, 'MAIN');
  assert.equal(manifest.content_scripts[0].run_at, 'document_start');
  assert.deepEqual(manifest.content_scripts[1].js, ['service.js', 'i18n.js', 'content.js']);
  assert.equal(manifest.default_locale, 'en');
  const key = manifest.description.match(/^__MSG_(.+)__$/)[1];
  for (const locale of ['en', 'zh_CN']) {
    const messages = JSON.parse(fs.readFileSync(path.join(root, '_locales', locale, 'messages.json'), 'utf8'));
    assert.ok(messages[key].message);
    assert.ok(messages[key].message.length <= 132);
  }
});

test('bundled privacy policies match the published drafts and local navigation resolves', () => {
  for (const name of ['index.html', 'privacy.html', 'privacy.zh-CN.html', 'support.html', 'styles.css', 'assets/icon-128.png']) {
    const file = path.join(root, 'privacy', name);
    assert.deepEqual(fs.readFileSync(file), fs.readFileSync(path.join(root, '../docs', name)));
    if (!name.endsWith('.html')) continue;
    for (const [, link] of fs.readFileSync(file, 'utf8').matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (/^(?:[a-z]+:|#)/i.test(link)) continue;
      assert.ok(fs.existsSync(path.resolve(path.dirname(file), link.split('#')[0])), `${name}: ${link}`);
    }
  }
});
