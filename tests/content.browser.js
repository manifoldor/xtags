(async () => {
  const results = [], frames = [];
  const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const response = (choice = 'inform') => ({ answers: {
    intent: { choice, confidence: .9, probabilities: { [choice]: .9 } },
    rage_bait: { noul: .7 }, synthetic: { noul: .1 }, undisclosed_ad: { noul: .1 },
  }, usage: { input_tokens: 100 } });
  const post = (id, reply = false) => `<article data-testid="tweet"><div><a href="/alice">Alice</a><a href="/alice/status/${id}"><time>now</time></a></div>${reply ? '<div>Replying to @bob</div>' : ''}<div data-testid="tweetText">Post ${id}</div></article>`;
  async function make({ data = {}, html = '', beforeRead, systemLanguage = 'zh-CN', fullText = {} } = {}) {
    const frame = document.createElement('iframe'); frames.push(frame); document.body.append(frame);
    const w = frame.contentWindow; w.document.body.innerHTML = html;
    for (const [id, text] of Object.entries(fullText)) {
      const article = [...w.document.querySelectorAll('article[data-testid="tweet"]')]
        .find(el => el.querySelector(`a[href$="/status/${id}"]`));
      if (article) article.__reactFiber$test = { memoizedProps: { tweet: {
        id_str: id, note_tweet: { is_expandable: true, text }, full_text: article.querySelector('[data-testid="tweetText"]').innerText,
      } } };
    }
    const store = { apiKey: 'test-only', enabled: true, consentVersion: 2, showHud: false, resetToken: 0, ...data };
    const publicView = (saved) => ({
      hasKey: !!saved.apiKey, keyRevision: saved.keyRevision ?? "",
      enabled: saved.enabled === true, consentVersion: saved.consentVersion ?? 0,
      apiEndpoint: saved.apiEndpoint ?? 'https://api.typesafe.ai/v1/systemone',
      consentEndpoint: saved.consentEndpoint ?? 'https://api.typesafe.ai/v1/systemone',
      model: saved.model ?? 'jev-latest', resetToken: saved.resetToken ?? 0, retryToken: saved.retryToken ?? 0,
      threshold: saved.threshold ?? .8, showAll: !!saved.showAll, skipReplies: saved.skipReplies !== false,
      showHud: saved.showHud !== false, language: saved.language ?? 'auto',
    });
    const calls = [], cancellations = [], listeners = [], timers = new Map(); let serial = 0;
    w.setTimeout = (fn, delay) => { timers.set(++serial, { fn, delay }); return serial; };
    w.clearTimeout = id => timers.delete(id);
    async function set(obj) {
      const before = publicView(store);
      for (const [k, v] of Object.entries(obj)) store[k] = structuredClone(v);
      const after = publicView(store);
      for (const fn of listeners) fn({ publicConfig: { oldValue: before, newValue: after } });
      await flush();
    }
    w.chrome = {
      i18n: { getUILanguage: () => systemLanguage },
      storage: {
        local: { get: async () => { throw new Error('content script cannot read trusted storage'); } },
        session: { onChanged: { addListener: fn => listeners.push(fn) } },
      },
      runtime: { sendMessage: (msg, cb) => {
        if (msg.type === 'jev-cancel') {
          cancellations.push(msg);
          calls.find(c => c.msg.requestId === msg.requestId)?.cb({ok:false, cancelled:true}); cb({ok:true}); return;
        }
        if (msg.type !== 'xtags-config') { calls.push({ msg, cb }); return; }
        const snapshot = publicView(store);
        Promise.resolve().then(() => beforeRead?.(set)).then(() => cb({ ok: true, data: snapshot }));
      } },
    };
    w.eval(fixtures.serviceCode); w.eval(fixtures.translations); w.eval(fixtures.fullTextSource); w.eval(source); await w.ready; await flush();
    return { w, store, calls, cancellations, timers, set, a: w.audit,
      async systemLanguage(value) { systemLanguage = value; w.dispatchEvent(new w.Event("languagechange")); await flush(); },
      badge(id) { return w.document.querySelector(`[data-xtags-badge="${id}"]`); },
      async reply(index, value = response()) { calls[index].cb({ ok: true, data: value }); await flush(); },
      async tick(delay = 250) {
        const timer = [...timers].find(([, v]) => v.delay === delay);
        assert(timer, `expected a ${delay}ms timer`); timers.delete(timer[0]); timer[1].fn(); await flush();
      },
    };
  }
  async function test(name, fn) {
    try { await fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, error: e.stack }); }
    finally { for (const frame of frames.splice(0)) frame.remove(); }
  }
  await test('idle HUD produces no self-triggered scans', async () => {
    const e = await make({ data: { showHud: true } });
    for (let i = 0; i < 8; i++) { e.a.scan(); await flush(); }
    assert(e.timers.size === 0, 'HUD scheduled its own scan');
  });
  await test('collapsed long post sends the full Note Tweet before the first classification', async () => {
    const preview = 'Opening paragraph';
    const full = `${preview}\n\nA later sales pitch changes the intent.`;
    const html = post('99').replace('Post 99', preview).replace('</article>',
      '<button data-testid="tweet-text-show-more-link">Show more</button></article>');
    const e = await make({ html, fullText: { '99': full } });
    assert(e.calls.length === 1 && e.calls[0].msg.state.post.text === full, 'preview was classified');
    await e.reply(0, response('sell'));
    assert(e.badge('99')?.textContent.includes('推销'), 'full-text judgment was not shown while collapsed');
    e.w.document.querySelector('[data-testid="tweetText"]').textContent = full;
    e.w.document.querySelector('[data-testid="tweet-text-show-more-link"]').remove();
    await flush(); await e.tick();
    assert(e.calls.length === 1, `expanding unchanged full text classified twice: ${JSON.stringify(e.calls.map(call => call.msg.state.post.text))}`);
  });
  await test('missing full text is never classified as the preview', async () => {
    const html = post('98').replace('</article>',
      '<button data-testid="tweet-text-show-more-link">Show more</button></article>');
    const e = await make({ html });
    assert(e.calls.length === 0 && e.badge('98')?.textContent.includes('全文暂不可用'), 'preview was sent or status missing');
    const article = e.w.document.querySelector('article');
    article.__reactFiber$test = {
      memoizedProps: { tweet: { id_str: '98' } },
      return: { memoizedProps: { tweet: { id_str: '98', note_tweet: { text: 'Post 98 with the rest' } } } },
    };
    await e.tick(500); // Page data can arrive without a DOM mutation.
    assert(e.calls.length === 1 && e.calls[0].msg.state.post.text === 'Post 98 with the rest', 'late full text was not used');
    assert(e.timers.size === 0, 'resolved full text kept retry timers');
  });
  await test('unavailable full text retries a limited number of times without uploading the preview', async () => {
    const html = post('97').replace('</article>',
      '<button data-testid="tweet-text-show-more-link">Show more</button></article>');
    const e = await make({ html });
    for (const delay of [500, 1500, 3500]) await e.tick(delay);
    assert(e.calls.length === 0 && e.timers.size === 0, 'preview was uploaded or retry did not stop');
    assert(e.badge('97')?.textContent.includes('全文暂不可用'), 'unavailable state disappeared');
    e.w.document.querySelector('article').remove(); await flush(); await e.tick();
    e.w.document.body.insertAdjacentHTML('beforeend', html); await flush(); await e.tick();
    assert([...e.timers.values()].some(timer => timer.delay === 500), 'remounted post did not get a fresh retry budget');
  });
  await test('full-text retry survives replacement of a timeline article', async () => {
    const html = post('95').replace('</article>',
      '<button data-testid="tweet-text-show-more-link">Show more</button></article>');
    const e = await make({ html });
    e.w.document.querySelector('article').outerHTML = html;
    e.w.document.querySelector('article').__reactFiber$test = {
      memoizedProps: { tweet: { id_str: '95', note_tweet: { text: 'Post 95 and its later argument' } } },
    };
    await flush(); await e.tick(500);
    assert(e.calls.length === 1 && e.calls[0].msg.state.post.text === 'Post 95 and its later argument',
      'replaced article was skipped by the pending retry');
  });
  await test('pausing clears full-text retry timers', async () => {
    const html = post('94').replace('</article>',
      '<button data-testid="tweet-text-show-more-link">Show more</button></article>');
    const e = await make({ html });
    assert(e.timers.size === 1, 'full-text retry was not scheduled');
    await e.set({ enabled: false });
    assert(e.timers.size === 0 && e.calls.length === 0, 'paused page kept retrying or uploaded the preview');
  });
  await test('reply statistics do not grow on repeated scans', async () => {
    const e = await make({ data: { showHud: true }, html: post('1', true) });
    for (let i = 0; i < 8; i++) e.a.scan(); await flush();
    assert(/跳过\s+1\s/.test(e.w.document.querySelector('[data-xtags-hud]').textContent), 'reply counted more than once');
    assert(e.calls.length === 0 && e.timers.size === 0, 'reply or HUD triggered work');
  });
  await test('pause stops queued requests and ignores late answers; resume recovers', async () => {
    const e = await make({ html: ['1', '2', '3', '4', '5', '6'].map(id => post(id)).join('') });
    assert(e.calls.length === 3, 'initial concurrency'); await e.set({ enabled: false });
    await e.reply(0); await e.reply(1); await e.reply(2);
    assert(e.calls.length === 3 && !e.w.document.querySelector('[data-xtags-badge]'), 'pause continued work');
    await e.set({ enabled: true }); assert(e.calls.length === 6, 'resume did not recover');
    await e.reply(3); assert(e.badge('1'), 'resumed post not painted');
  });
  await test('virtualized article updates its badge to the new post ID', async () => {
    const e = await make({ html: post('1') + post('2') }); await e.reply(0); await e.reply(1, response('sell'));
    assert(e.timers.size === 0, 'own badge changes triggered scans');
    const articles = e.w.document.querySelectorAll('article'); articles[1].remove();
    articles[0].querySelector('a[href*="/status/"]').setAttribute('href', '/alice/status/2');
    articles[0].querySelector('[data-testid="tweetText"]').textContent = 'Post 2';
    await flush(); await e.tick();
    assert(!e.badge('1') && e.badge('2')?.textContent.includes('推销'), 'wrong post badge retained');
    assert(e.calls.length === 2, 'cached post requested again');
  });
  await test('recycled node loses stale badge even when new request fails', async () => {
    const e = await make({ html: post('1') }); await e.reply(0);
    e.w.document.querySelector('a[href*="/status/"]').href = '/alice/status/3'; await flush(); await e.tick();
    e.calls[1].cb({ ok: false, error: 'network' }); await flush();
    assert(!e.w.document.querySelector('[data-xtags-badge]'), 'stale badge visible after failure');
  });
  await test('current threshold is used immediately and after reloading cached raw answers', async () => {
    const e = await make({ html: post('1') }); await e.reply(0);
    assert(!e.badge('1').textContent.includes('诱导愤怒'), 'initial threshold ignored');
    await e.set({ threshold: .5 }); assert(e.badge('1').textContent.includes('诱导愤怒'), 'lower threshold not applied');
    assert(e.calls.length === 1, 'threshold change made a request');
    const reloaded = await make({ data: e.store, html: post('1') });
    await reloaded.reply(0, { ...response(), cached: true, usage: { input_tokens: 0 } });
    assert(reloaded.badge('1').textContent.includes('诱导愤怒'), 'reload used stale derived signals');
  });
  await test('zero threshold works on startup and live changes', async () => {
    const e = await make({ data: { threshold: 0 }, html: post('1') }); await e.reply(0);
    assert(e.badge('1').children.length === 4, 'zero ignored on startup');
    await e.set({ threshold: 1 }); assert(e.badge('1').children.length === 1, 'threshold 1 ignored');
    await e.set({ threshold: 0 }); assert(e.badge('1').children.length === 4, 'zero ignored on update');
  });
  await test('corrected API key retries previously failed posts and clears inflight', async () => {
    const e = await make({ html: post('1') }); e.calls[0].cb({ ok: false, error: '401' }); await flush();
    assert(e.a.inflight.size === 0, 'failed request leaked inflight state');
    await e.set({ apiKey: 'corrected-test-key', keyRevision: 'new-key-revision' });
    assert(e.calls.length === 2, 'failed ID still blocked');
    await e.reply(1); assert(e.badge('1') && e.a.inflight.size === 0, 'successful request leaked state');
  });
  await test('a changed post body can recover from a previous request failure', async () => {
    const e = await make({ html: post('96') });
    e.calls[0].cb({ ok: false, error: 'network' }); await flush();
    await e.tick();
    assert(e.calls.length === 1, 'unchanged failed body retried automatically');
    e.w.document.querySelector('[data-testid="tweetText"]').textContent = 'Post 96 with a new ending';
    await flush(); await e.tick();
    assert(e.calls.length === 2 && e.calls[1].msg.state.post.text === 'Post 96 with a new ending',
      'new body stayed blocked by the old failure');
  });
  await test('reset ignores old result without deleting new inflight job', async () => {
    const e = await make({ html: post('1') }); await e.set({ resetToken: 'reset-2' });
    assert(e.calls.length === 2 && e.calls[1].msg.resetToken === 'reset-2', 'new generation not requested');
    await e.reply(0); assert(!e.badge('1') && e.a.cache.size === 0, 'old result repopulated cache');
    assert(e.a.inflight.has('1'), 'old finally removed new inflight job');
    await e.reply(1, response('sell')); assert(e.badge('1').textContent.includes('推销'), 'new result missing');
  });
  await test('enabling skip replies removes existing reply badges and blocks late paint', async () => {
    const e = await make({ data: { skipReplies: false }, html: post('1', true) + post('2', true) });
    await e.reply(0); await e.set({ skipReplies: true }); await e.reply(1);
    assert(!e.w.document.querySelector('[data-xtags-badge]'), 'skipped replies retain labels');
  });
  await test('configuration changes during startup override the old storage snapshot', async () => {
    const e = await make({ html: post('1'), beforeRead: async set => set({ enabled: false }) });
    assert(e.calls.length === 0, 'startup overwrote paused state');
  });
  await test('English auto locale translates badges, tooltips and HUD', async () => {
    const e = await make({ systemLanguage: 'en-GB', data: { showHud: true, showAll: true }, html: post('1') });
    await e.reply(0);
    const badge = e.badge('1');
    assert(badge.textContent.includes('Inform 0.90') && badge.textContent.includes('Rage bait 0.70'), 'English badge missing');
    assert(badge.title.includes('Confidence') && badge.lang === 'en', 'English tooltip missing');
    assert(e.w.document.querySelector('[data-xtags-hud]').textContent.includes('Assessed'), 'HUD not localized');
  });
  await test('live language selection rerenders cached answers without extra API calls', async () => {
    const e = await make({ data: { showHud: true }, html: post('1') + post('2') });
    await e.reply(0); const count = e.calls.length;
    await e.set({ language: 'en' });
    assert(e.badge('1').textContent.includes('Inform'), 'cached badge did not change');
    assert(e.calls.length === count && e.a.inflight.has('2'), 'language change restarted requests');
    await e.reply(1, response('sell')); assert(e.badge('2').textContent.includes('Sell'), 'pending result used old language');
    await e.set({ language: 'zh' }); assert(e.badge('1').textContent.includes('告知'), 'Chinese switch failed');
    assert(e.calls.length === count && e.timers.size === 0, 'language repaint triggered work');
  });
  await test('system changes update auto but never override manual selection', async () => {
    const e = await make({ html: post('1') }); await e.reply(0);
    await e.systemLanguage('en-US'); assert(e.badge('1').textContent.includes('Inform'), 'auto did not follow system');
    await e.set({ language: 'zh' }); await e.systemLanguage('fr-FR');
    assert(e.badge('1').textContent.includes('告知'), 'manual choice was overridden');
    await e.set({ language: 'auto' }); assert(e.badge('1').textContent.includes('Inform'), 'unsupported system locale did not use English');
    assert(e.calls.length === 1, 'locale changes requested new judgments');
  });
  await test('existing errors and paused status translate immediately', async () => {
    const e = await make({ data: { showHud: true }, html: post('1') });
    e.calls[0].cb({ ok: false, error: '请求超时', code: 'errorTimeout' }); await flush();
    await e.set({ language: 'en' });
    const hud = () => e.w.document.querySelector('[data-xtags-hud]').textContent;
    assert(hud().includes('The request timed out') && !hud().includes('请求超时'), 'stored error stayed Chinese');
    assert(e.calls.length === 1, 'language change retried failure');
    await e.set({ enabled: false }); assert(hud().includes('Paused'), 'paused status not English');
    await e.set({ language: 'zh' }); assert(hud().includes('已暂停'), 'paused status not Chinese');
  });

  async function makePanel({ store = {}, systemLanguage = 'en-US', onSaved = async () => {}, beforeWrite = async () => {}, beforeClear = async () => {}, health = null, failHealth = false, failRead = false, panel = 'settings', width = 760, failOpen = false, allowPermission = true } = {}) {
    const frame = document.createElement('iframe'); frames.push(frame);
    frame.style.cssText = `width:${width}px;height:700px;border:0`; document.body.append(frame);
    const w = frame.contentWindow; w.document.open(); w.document.write(fixtures[panel + "Markup"]); w.document.close();
    const listeners = [], timers = new Map(), pendingWrites = [], permissionRequests = [], removedPermissions = []; let serial = 0, fail = false, opened = 0;
    w.setTimeout = (fn, ms) => { timers.set(++serial, { fn, ms }); return serial; };
    w.clearTimeout = id => timers.delete(id);
    async function set(values) {
      if (fail) throw new Error('test write failure');
      await beforeWrite(values);
      const changes = {};
      for (const [key, value] of Object.entries(values)) { changes[key] = { oldValue: store[key], newValue: value }; store[key] = value; }
      for (const fn of listeners) fn(changes, 'local');
      await onSaved(values);
    }
    w.chrome = {
      i18n: { getUILanguage: () => systemLanguage },
      permissions: { request: async value => { permissionRequests.push(value); return allowPermission; }, remove: async value => { removedPermissions.push(value); return true; } },
      runtime: { sendMessage: (msg, cb) => {
        if (msg.type === 'xtags-clear-cache') beforeClear().then(() => set({ enabled: false, resetToken: w.crypto.randomUUID() })).then(() => cb({ok:true}), () => cb({ok:false}));
      }, getManifest: () => fixtures.manifest, openOptionsPage: async () => { if (failOpen) throw new Error("open failed"); opened++; } },
      storage: { session: { get: async defaults => { if (failHealth) throw new Error('session unavailable'); return {...defaults, serviceHealth: health}; } }, local: { get: async defaults => {
        if (failRead) throw new Error('test read failure');
        return { ...defaults, ...structuredClone(store) };
      }, set: values => {
        const pending = set(values); pendingWrites.push(pending.catch(() => {})); return pending;
      } }, onChanged: { addListener: fn => listeners.push(fn) } },
    };
    w.eval(fixtures.serviceCode); w.eval(fixtures.translations);
    w.eval(fixtures[panel + 'Code'].replace('load();', 'globalThis.popupReady = load();'));
    await w.popupReady; await flush();
    return { w, store, timers, set, permissionRequests, removedPermissions, get opened() { return opened; }, failWrites(value) { fail = value; },
      async setHealth(value) { for (const fn of listeners) fn({serviceHealth: {newValue: value}}, 'session'); await flush(); },
      async choose(value) {
        const el = w.document.getElementById('language'); el.value = value; el.dispatchEvent(new w.Event('change'));
        await Promise.all(pendingWrites.splice(0)); await flush();
      },
    };
  }
  await test('settings auto/manual choices persist, reopen and synchronize to open pages', async () => {
    const page = await make({ html: post('1') }); await page.reply(0);
    const other = await make({ html: post('2') }); await other.reply(0);
    const store = {};
    const e = await makePanel({ store, onSaved: async values => { await page.set(values); await other.set(values); } });
    assert(e.w.document.documentElement.lang === 'en' && e.w.document.getElementById('language').value === 'auto', 'auto startup incorrect');
    assert(e.w.document.querySelector('[data-i18n="threshold"]').textContent === 'Signal threshold', 'English popup missing');
    await e.choose('zh'); assert(store.language === 'zh' && e.w.document.documentElement.lang === 'zh-CN', 'manual choice not saved');
    await e.choose('en');
    assert(page.badge('1').textContent.includes('Inform') && other.badge('2').textContent.includes('Inform'), 'open pages not synchronized');
    assert(page.calls.length === 1 && other.calls.length === 1, 'language sync called API');
    const reopened = await makePanel({ store, systemLanguage: 'zh-CN' });
    assert(reopened.w.document.documentElement.lang === 'en' && reopened.w.document.getElementById('language').value === 'en', 'saved choice not restored');
    await reopened.choose('auto'); assert(reopened.w.document.documentElement.lang === 'zh-CN', 'auto selection did not restore system locale');
  });
  await test('settings reset messages and write failures use the selected language', async () => {
    const e = await makePanel(); const doc = e.w.document;
    doc.getElementById('reset').click(); await flush();
    assert(doc.getElementById('reset').textContent === 'Paused and cache cleared', 'English reset missing');
    await e.choose('zh'); assert(doc.getElementById('reset').textContent === '已暂停并清空缓存', 'transient message not retranslated');
    const timer = [...e.timers].find(([, timer]) => timer.ms === 1600); e.timers.delete(timer[0]); timer[1].fn();
    assert(doc.getElementById('reset').textContent === '暂停并清空缓存', 'reset timer restored wrong language');
    await e.choose('en'); e.failWrites(true); await e.choose('zh');
    assert(doc.getElementById('language').value === 'en' && !doc.getElementById('language').disabled, 'failed write kept unsaved choice');
    assert(!doc.getElementById('status').hidden && doc.getElementById('status').textContent.includes('Could not save'), 'save error missing');
  });
  await test('settings page fits desktop and narrow layouts in both languages', async () => {
    for (const language of ['en', 'zh']) for (const width of [760, 360]) {
      const e = await makePanel({ store: { language }, width }); const doc = e.w.document;
      assert(!doc.body.hidden && !doc.getElementById('aboutBody').hidden, 'settings or version hidden');
      assert(doc.getElementById('ver').textContent === 'v' + fixtures.manifest.version, 'version not rendered');
      assert(doc.documentElement.scrollWidth <= width && doc.body.scrollWidth <= width, 'settings horizontal overflow');
    }
  });
  await test('legacy pages do not extract/request posts until consent and stop on withdrawal', async () => {
    const e = await make({ data: { consentVersion: undefined, showHud: true }, html: post('1') + post('2') });
    assert(e.calls.length === 0 && e.a.inflight.size === 0, 'legacy enabled state bypassed consent');
    assert(e.w.document.querySelector('[data-xtags-hud]').textContent.includes('数据传输'), 'consent hint missing');
    await e.set({ language: 'en', apiKey: 'another-key', enabled: true });
    assert(e.calls.length === 0, 'settings bypassed consent');
    await e.set({ consentVersion: 2 }); assert(e.calls.length === 2, 'consent did not start classification');
    await e.reply(0); assert(e.badge('1'), 'consented result missing');
    await e.set({ consentVersion: 0 }); await e.reply(1);
    assert(!e.badge('1') && !e.badge('2') && !e.a.cache.has('2'), 'withdrawal kept labels or late results');
  });
  await test('withdrawal during content startup wins over stale consent snapshot', async () => {
    const e = await make({ html: post('1'), beforeRead: async set => set({ consentVersion: 0 }) });
    assert(e.calls.length === 0, 'startup used withdrawn consent');
  });
  await test('settings requires unchecked acknowledgement, persists consent, and supports withdrawal', async () => {
    const store = { enabled: true, apiKey: 'existing-key', consentVersion: 1 };
    const e = await makePanel({ store }); const doc = e.w.document;
    const check = doc.getElementById('consentCheck'), grant = doc.getElementById('grantConsent');
    assert(!check.checked && grant.disabled && doc.getElementById('enabled').disabled, 'old consent silently enabled');
    assert(!doc.getElementById('enabled').checked && !doc.getElementById('disclosureDetails').hidden, 'legacy state obscures disclosure');
    assert(doc.querySelector('[data-i18n="disclosureScope"]').textContent.includes('full text'), 'collapsed full-text transfer missing from notice');
    assert(doc.getElementById('privacyPolicy').getAttribute('href') === 'privacy/privacy.html', 'policy not bundled');
    check.click(); assert(!grant.disabled, 'acknowledgement did not unlock action');
    assert(store.consentVersion === 1, 'checkbox alone granted new consent');
    grant.click(); await flush();
    assert(store.consentVersion === 2 && store.enabled === true && doc.getElementById('consentPrompt').hidden, 'consent not saved');
    await e.choose('zh');
    assert(store.consentVersion === 2 && doc.getElementById('privacyPolicy').getAttribute('href').endsWith('privacy.zh-CN.html'), 'locale lost consent/policy');
    assert(doc.querySelector('[data-i18n="disclosureScope"]').textContent.includes('全文'), 'Chinese full-text notice missing');
    const reopened = await makePanel({ store });
    assert(reopened.w.document.getElementById('consentPrompt').hidden, 'consent not restored');
    doc.getElementById('revokeConsent').click(); await flush();
    assert(store.consentVersion === 0 && store.enabled === false && !check.checked && grant.disabled, 'withdrawal not saved');
    assert(store.apiKey === 'existing-key' && !doc.getElementById('apiKey').disabled && !doc.getElementById('settings').disabled, 'local cleanup unavailable after withdrawal');
  });
  await test('failed consent writes never show enabled; failed withdrawal reports actual saved state', async () => {
    const e = await makePanel(); const doc = e.w.document;
    e.failWrites(true); doc.getElementById('consentCheck').click(); doc.getElementById('grantConsent').click(); await flush();
    assert(e.store.consentVersion === undefined && !doc.getElementById('enabled').checked, 'failed consent enabled upload');
    assert(!doc.getElementById('status').hidden && !doc.getElementById('consentPrompt').hidden, 'failed consent not explained');
    e.failWrites(false); doc.getElementById('grantConsent').click(); await flush();
    e.failWrites(true); doc.getElementById('revokeConsent').click(); await flush();
    assert(e.store.consentVersion === 2 && doc.getElementById('consentPrompt').hidden, 'failed withdrawal claimed success');
    assert(!doc.getElementById('status').hidden, 'failed withdrawal not explained');
  });
  await test('settings keeps requests disabled until consent is persisted and prevents duplicate clicks', async () => {
    let release, writes = 0;
    const gate = new Promise(resolve => { release = resolve; });
    const page = await make({ data: { consentVersion: 0 }, html: post('1') });
    const e = await makePanel({ beforeWrite: async () => { writes++; await gate; }, onSaved: values => page.set(values) });
    const doc = e.w.document;
    doc.getElementById('consentCheck').click(); doc.getElementById('grantConsent').click(); await flush();
    doc.getElementById('grantConsent').click(); await flush();
    assert(writes === 1 && page.calls.length === 0 && !doc.getElementById('enabled').checked, 'consent applied before persistence');
    release(); await flush();
    assert(page.calls.length === 1 && e.store.consentVersion === 2, 'persisted consent not applied');
  });
  await test('settings read failure cannot be mistaken for consent or enable upload', async () => {
    const e = await makePanel({ store: { enabled: true, consentVersion: 2 }, failRead: true });
    const doc = e.w.document;
    assert(doc.getElementById('consentCheck').disabled && doc.getElementById('grantConsent').disabled, 'unknown state can grant consent');
    assert(doc.getElementById('settings').disabled && !doc.getElementById('enabled').checked, 'failed read looks enabled');
    assert(doc.getElementById('status').textContent.includes('Could not load'), 'read failure not shown');
  });

  await test('compact popup opens the registered options page and cannot grant consent', async () => {
    assert(fixtures.manifest.options_ui.page === 'settings.html' && fixtures.manifest.options_ui.open_in_tab, 'native options page not configured');
    const e = await makePanel({ panel: 'popup', width: 360 }); const doc = e.w.document;
    assert(!doc.getElementById('apiKey') && !doc.getElementById('consentCheck') && !doc.getElementById('ver'), 'setup details remain in popup');
    assert(doc.getElementById('enabled').disabled && !doc.getElementById('setupNotice').hidden, 'unconsented popup can enable');
    doc.getElementById('openSettings').click(); await flush(); assert(e.opened === 1, 'options page not opened');
    assert(e.store.consentVersion === undefined, 'opening settings grants consent');
    await e.choose('zh'); assert(doc.getElementById('openSettings').textContent === '设置', 'settings link not localized');
    assert(doc.body.getBoundingClientRect().height < 600, 'popup too tall');
    const failed = await makePanel({ panel: 'popup', failOpen: true });
    failed.w.document.getElementById('openSettings').click(); await flush();
    assert(failed.w.document.getElementById('status').textContent.includes('Could not open Settings'), 'open failure missing');
  });
  await test('settings and popup synchronize consent, key, preferences and language in both directions', async () => {
    const quick = await makePanel({ panel: 'popup', width: 360 });
    const settings = await makePanel({ onSaved: values => quick.set(values) });
    const doc = settings.w.document, popup = quick.w.document;
    doc.getElementById('consentCheck').click(); doc.getElementById('grantConsent').click(); await flush();
    assert(popup.getElementById('enabled').disabled, 'missing key did not block quick enable');
    doc.getElementById('apiKey').value = 'test-only-key';
    doc.getElementById('apiKey').dispatchEvent(new settings.w.Event('change'));
    await flush();
    assert(typeof settings.store.keyRevision === 'string' && settings.store.keyRevision.length > 0,
      'key change did not update its public revision');
    assert(!popup.getElementById('enabled').disabled && popup.getElementById('enabled').checked, 'key/consent not synchronized');
    await settings.choose('zh'); assert(popup.documentElement.lang === 'zh-CN', 'settings language did not sync');
    await quick.set({ threshold: .4, showAll: true });
    await settings.set({ threshold: quick.store.threshold, showAll: quick.store.showAll });
    assert(doc.getElementById('threshold').value === '0.4' && doc.getElementById('showAll').checked, 'external preferences not rendered');
    doc.getElementById('revokeConsent').click(); await flush();
    assert(popup.getElementById('enabled').disabled && !popup.getElementById('enabled').checked, 'withdrawal not synchronized');
    assert(!popup.getElementById('setupNotice').hidden, 'setup notice not restored');
  });
  await test('quick popup save failure restores the saved enable and threshold state', async () => {
    const e = await makePanel({ panel: 'popup', store: { consentVersion: 2, apiKey: 'test-only', enabled: true, threshold: .8 } });
    const doc = e.w.document; e.failWrites(true);
    doc.getElementById('enabled').click(); await flush();
    assert(doc.getElementById('enabled').checked && e.store.enabled, 'failed pause looks paused');
    doc.getElementById('threshold').value = '.2'; doc.getElementById('threshold').dispatchEvent(new e.w.Event('change')); await flush();
    assert(doc.getElementById('threshold').value === '0.8' && !doc.getElementById('status').hidden, 'failed threshold looks saved');
  });

  await test('custom service save authorizes only the selected host and clears old credentials and consent', async () => {
    const e = await makePanel({ store: { apiKey: 'official-key', enabled: true, consentVersion: 2 } });
    const doc = e.w.document, url = 'https://proxy.example:8443/v1/systemone';
    assert(doc.getElementById('provider').value === 'official', 'official not default');
    doc.getElementById('provider').value = 'custom'; doc.getElementById('provider').dispatchEvent(new e.w.Event('change'));
    doc.getElementById('apiEndpoint').value = url;
    assert(e.store.apiKey === 'official-key', 'editing draft changed active service');
    assert(doc.getElementById('settings').disabled && doc.getElementById('consentCheck').disabled, 'unsaved destination allows entering a credential or consent');
    doc.getElementById('saveEndpoint').click(); await flush();
    assert(e.permissionRequests[0].origins[0] === 'https://proxy.example/*', 'requested broad host access');
    assert(e.store.apiEndpoint === url && e.store.apiKey === '' && e.store.enabled === false, 'old credential or enabled state carried over');
    assert(e.store.consentVersion === 0 && e.store.consentEndpoint === '' && e.store.resetToken, 'consent/cache not invalidated');
    assert(doc.getElementById('currentEndpoint').textContent === url && doc.getElementById('providerPrivacy').hidden, 'wrong recipient/policy shown');
    assert(doc.querySelector('[data-i18n="disclosureSummary"]').textContent.includes('custom service'), 'custom disclosure missing');
    doc.getElementById('consentCheck').click(); doc.getElementById('grantConsent').click(); await flush();
    assert(e.store.consentEndpoint === url && e.store.consentVersion === 2, 'consent not bound to recipient');
    await e.set({ apiKey: 'custom-key' });
    doc.getElementById('provider').value = 'official'; doc.getElementById('saveEndpoint').click(); await flush();
    assert(e.store.apiEndpoint === 'https://api.typesafe.ai/v1/systemone' && e.store.apiKey === '', 'switching back reused custom key');
    assert(e.removedPermissions[0].origins[0] === 'https://proxy.example/*', 'unused custom host not released');
  });
  await test('invalid URL, denied permission and failed save leave the active service and key unchanged', async () => {
    for (const mode of ['invalid', 'denied', 'failed']) {
      const e = await makePanel({ store: { apiKey: 'official-key', enabled: true, consentVersion: 2 }, allowPermission: mode !== 'denied' });
      const doc = e.w.document; doc.getElementById('provider').value = 'custom';
      doc.getElementById('apiEndpoint').value = mode === 'invalid' ? 'http://proxy.example/api' : 'https://proxy.example/api';
      if (mode === 'failed') e.failWrites(true);
      doc.getElementById('saveEndpoint').click(); await flush();
      assert(e.store.apiEndpoint === undefined && e.store.apiKey === 'official-key' && e.store.consentVersion === 2, 'failed service change mutated active config');
      assert(!doc.getElementById('status').hidden, 'failure not explained');
      if (mode === 'invalid') assert(e.permissionRequests.length === 0, 'invalid URL requested permission');
    }
  });
  await test('content binds requests and cached labels to selected service and does not estimate custom prices', async () => {
    const e = await make({ data: { showHud: true }, html: post('1') }); await e.reply(0);
    const apiEndpoint = 'https://proxy.example/v1/systemone';
    await e.set({ apiEndpoint });
    assert(e.calls.length === 1 && !e.badge('1'), 'changed service reused old consent or badge');
    await e.set({ consentEndpoint: apiEndpoint, consentVersion: 2 });
    assert(e.calls.length === 2 && e.calls[1].msg.apiEndpoint === apiEndpoint, 'request not bound to new service');
    await e.reply(1);
    assert(!e.w.document.querySelector('[data-xtags-hud]').textContent.includes('≈$'), 'official pricing applied to custom provider');
  });

  await test('queued posts are revalidated after removal, reply changes and recycled text', async () => {
    const e = await make({ data: {skipReplies: false}, html: ['1','2','3','4','5','6'].map(id => post(id, id === '5')).join('') });
    assert(e.calls.length === 3, 'initial concurrency');
    const articles = e.w.document.querySelectorAll('article');
    articles[3].remove();
    articles[5].querySelector('[data-testid="tweetText"]').textContent = 'Updated main post';
    await e.set({skipReplies: true});
    await e.reply(0); await e.reply(1); await e.reply(2);
    assert(!e.calls.some(c => ['4','5'].includes(c.msg.id)), 'stale queue was sent');
    assert(e.calls.length === 4 && e.calls[3].msg.state.post.text === 'Updated main post', 'recycled preview sent');
    assert(!e.a.inflight.has('4') && !e.a.inflight.has('5'), 'stale job remained pending');
  });
  await test('the final dispatch guard drops recycled nodes even before mutation scan', async () => {
    const e = await make({html: ['1','2','3','4'].map(id => post(id)).join('')});
    const el = e.w.document.querySelectorAll('article')[3]; el.remove();
    await e.reply(0);
    assert(e.calls.length === 3 && !e.a.inflight.has('4'), 'removed post uploaded before next scan');
  });
  await test('removed running posts notify background; page hide cancels remaining consumers', async () => {
    const e=await make({html:post('1')+post('2')});
    e.w.document.querySelector('article').remove(); await flush(); await e.tick();
    assert(e.cancellations.length===1 && e.cancellations[0].requestId===e.calls[0].msg.requestId,'missing background cancellation');
    await e.reply(0); assert(!e.a.cache.has('1'),'cancelled result returned');
    e.w.dispatchEvent(new e.w.Event('pagehide')); await flush();
    assert(e.cancellations.length===2,'page hide kept consumers');
  });
  await test('content queue stays bounded and ignores unrelated page mutations', async () => {
    const e = await make({html: Array.from({length: 130}, (_,i) => post(String(i + 1))).join('')});
    assert(e.a.queue.length <= 100 && e.calls.length === 3, 'unbounded queue');
    const aside = e.w.document.createElement('aside'); e.w.document.body.append(aside); await flush();
    const before = e.w.extractCount;
    for (let i = 0; i < 50; i++) aside.textContent = 'Trend ' + i;
    await flush(); assert(e.w.extractCount === before && e.timers.size === 0, 'unrelated mutations scheduled extraction');
  });
  await test('quote-only cards are not mislabeled as their outer author', async () => {
    for (const wrapper of ['<div role="link">', '<div data-testid="quoteTweet">', '<article data-testid="tweet">']) {
      const close = wrapper.startsWith('<article') ? '</article>' : '</div>';
      const quote = wrapper + '<a href="/bob/status/22"><time>now</time></a><div data-testid="tweetText">Quoted text</div>' + close;
      const e = await make({html: '<article data-testid="tweet"><a href="/alice/status/11"><time>now</time></a>' + quote + '</article>'});
      assert(!e.calls.some(c => c.msg.id === '11'), 'quote attached to outer ID');
      if (wrapper.startsWith('<article')) assert(e.calls[0]?.msg.state.post.author === '@bob', 'nested article author wrong');
    }
  });
  await test('main body, status author and reply marker stay outside quoted content', async () => {
    const e = await make({html: '<article data-testid="tweet"><a href="/resharer">Reshared by</a><a href="/alice/status/11"><time>now</time></a>' +
      '<div data-testid="tweetText">Main comment</div><div role="link"><a href="/bob/status/22"><time>now</time></a>' +
      '<div>Replying to @someone</div><div data-testid="tweetText">Quote</div><button data-testid="tweet-text-show-more-link">more</button></div></article>'});
    assert(e.calls.length === 1, 'quoted reply or show-more blocked main text');
    assert(e.calls[0].msg.state.post.author === '@alice' && e.calls[0].msg.state.post.text === 'Main comment', 'author/body mismatch');
    const bare = await make({html: post('12').replace('Post 12','Replying to the research in this main post').replace('</article>',
      '<div role="link"><div>Replying to @quoted</div></div></article>')});
    assert(bare.calls.length === 1, 'main body or quote wrapper was mistaken for a reply banner');
  });
  await test('transient failures retry on reconnect with a finite budget; manual retry resets it', async () => {
    const e = await make({html: post('1')});
    const fail = async index => { e.calls[index].cb({ok:false, code:'errorNetwork', retryable:true}); await flush(); };
    await fail(0); assert([...e.timers.values()].some(t => t.delay === 15000), 'first retry not armed');
    e.w.dispatchEvent(new e.w.Event('online')); await flush();
    assert(e.calls.length === 2, 'reconnect did not retry'); await fail(1);
    assert([...e.timers.values()].some(t => t.delay === 60000), 'second retry not delayed');
    await e.tick(60000); assert(e.calls.length === 3, 'second automatic retry missing'); await fail(2);
    for (let i = 0; i < 5; i++) { e.w.dispatchEvent(new e.w.Event('online')); e.a.scan(); await flush(); }
    assert(e.calls.length === 3, 'automatic retry loop exceeded budget');
    await e.set({retryToken: 'manual-1'}); assert(e.calls.length === 4, 'manual retry unavailable');
    await e.reply(3); assert(e.badge('1') && e.a.failed.size === 0, 'recovered result absent');
  });
  await test('authentication errors never retry automatically and pause clears recovery timers', async () => {
    const e = await make({html: post('1') + post('2')});
    e.calls[0].cb({ok:false, code:'errorAuth', status:401, retryable:false});
    e.calls[1].cb({ok:false, code:'errorTimeout', retryable:true}); await flush();
    e.w.dispatchEvent(new e.w.Event('online')); await flush();
    assert(e.calls.filter(c => c.msg.id === '1').length === 1, 'authentication error auto-retried');
    assert(e.calls.filter(c => c.msg.id === '2').length === 2, 'timeout not retried');
    e.calls[2].cb({ok:false, code:'errorTimeout', retryable:true}); await flush();
    await e.set({enabled:false});
    assert(![...e.timers.values()].some(t => [15000,60000].includes(t.delay)), 'pause left retry timers');
    e.w.dispatchEvent(new e.w.Event('online')); await flush(); assert(e.calls.length === 3, 'paused upload');
  });
  await test('language repaint extracts 60 visible posts once with 3000 cached results', async () => {
    const e = await make({data:{enabled:false}, html:Array.from({length:60},(_,i)=>post(String(i+1))).join('')});
    for(let i=1;i<=3000;i++) { e.a.cache.set(String(i), response().answers); e.a.cacheText.set(String(i), 'Post '+i); }
    await e.set({enabled:true}); assert(e.calls.length === 0, 'fixture cache missed');
    e.w.extractCount = 0; await e.set({language:'en'});
    assert(e.w.extractCount === 60, 'language scan count: '+e.w.extractCount);
    assert(e.w.document.querySelectorAll('[data-xtags-badge]').length === 60, 'missing repaint');
    assert(e.calls.length === 0 && e.timers.size === 0, 'repaint created network work or feedback loop');
  });
  await test('badge details support focus, keyboard, Escape and the actual X page theme', async () => {
    const e = await make({html:post('1')}); await e.reply(0);
    const badge = e.badge('1');
    const focusEvents = [];
    e.w.addEventListener('error', event => focusEvents.push(event.message));
    for (const type of ['focus','blur']) badge.addEventListener(type, () => focusEvents.push(type));
    assert(badge.tabIndex === 0 && badge.getAttribute('role') === 'button' && badge.getAttribute('aria-label'), 'not keyboard accessible');
    // Let Chrome attach/layout the freshly created iframe before native focus.
    await new Promise(resolve => e.w.requestAnimationFrame(resolve));
    badge.focus(); await flush();
    assert(e.w.document.querySelector('[role="tooltip"]') && badge.getAttribute('aria-describedby'), 'focus details absent: '+JSON.stringify({events:focusEvents,connected:badge.isConnected,active:e.w.document.activeElement?.outerHTML,body:e.w.document.body.innerHTML}));
    e.w.dispatchEvent(new e.w.Event('scroll')); await flush();
    assert(e.w.document.querySelector('[role="tooltip"]'), 'focus scrolling dismissed the description');
    badge.dispatchEvent(new e.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert(!e.w.document.querySelector('[role="tooltip"]'), 'Escape did not dismiss');
    badge.dispatchEvent(new e.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    assert(e.w.document.querySelector('[role="tooltip"]'), 'Enter did not reopen');
    e.w.document.body.style.backgroundColor = 'black'; await flush();
    assert(badge.firstChild.style.color === 'rgb(224, 229, 233)' && badge.firstChild.style.backgroundColor === 'rgb(41, 50, 56)', 'dark page not reflected');
    e.w.document.body.style.backgroundColor = 'white'; await flush();
    assert(badge.firstChild.style.color === 'rgb(68, 75, 80)', 'light page not reflected');
    assert(e.calls.length === 1, 'details or theme requested judgment');
  });
  await test('failed settings writes restore the committed key, threshold and toggles', async () => {
    const store = {apiKey:'saved-key', threshold:.8, consentVersion:2, enabled:true, skipReplies:true, showAll:false, showHud:true};
    const e = await makePanel({store}); const doc = e.w.document; e.failWrites(true);
    for (const [id, value] of [['apiKey','unsaved-key'],['threshold','.2'],['enabled',false],['skipReplies',false],['showAll',true],['showHud',false]]) {
      const input = doc.getElementById(id); const saved = store[id];
      if (typeof value === 'boolean') input.checked = value; else input.value = value;
      input.dispatchEvent(new e.w.Event('change')); await flush();
      assert((typeof value === 'boolean' ? input.checked : input.value) === (typeof value === 'boolean' ? saved : String(saved)), id+' retained failed draft');
      assert(!doc.getElementById('preferencesStatus').hidden && doc.getElementById('preferencesStatus').textContent.includes('Could not save'), 'nearby failure hidden');
    }
    e.failWrites(false);
    doc.getElementById('threshold').value = '.4'; doc.getElementById('threshold').dispatchEvent(new e.w.Event('change')); await flush();
    assert(store.threshold === .4 && doc.getElementById('preferencesStatus').textContent.toLowerCase().includes('saved'), 'recovery not saved');
  });
  await test('pending preference saves disable concurrent edits and then restore controls', async () => {
    let release;
    const e = await makePanel({beforeWrite:()=>new Promise(resolve=>{release=resolve;})}); const doc=e.w.document;
    doc.getElementById('threshold').value='.4'; doc.getElementById('threshold').dispatchEvent(new e.w.Event('change')); await flush();
    assert(doc.getElementById('settings').disabled && doc.getElementById('language').disabled, 'concurrent edits allowed');
    release(); await flush(); assert(!doc.getElementById('settings').disabled && e.store.threshold === .4, 'save did not settle');
  });
  await test('cache clearing waits for acknowledgement, pauses open pages and preserves credentials', async () => {
    const page=await make({html:post('1')}); await page.reply(0);
    let release;
    const e=await makePanel({store:{apiKey:'saved-key',enabled:true,consentVersion:2},beforeClear:()=>new Promise(resolve=>{release=resolve;}),onSaved:values=>page.set(values)});
    const doc=e.w.document; doc.getElementById('reset').click(); await flush();
    assert(!doc.getElementById('reset').textContent.includes('cleared') && doc.getElementById('settings').disabled,'premature success');
    release(); await flush(); page.a.scan(); await flush();
    assert(e.store.enabled === false && e.store.apiKey === 'saved-key','did not pause or key lost');
    assert(!page.badge('1') && page.calls.length === 1,'cache clear immediately reuploaded');
    assert(doc.getElementById('reset').textContent.includes('cleared'),'acknowledged success absent');
  });
  await test('failed cache clearing shows failure instead of claiming deletion', async () => {
    const e=await makePanel({beforeClear:async()=>{throw new Error('write failed');}});
    e.w.document.getElementById('reset').click(); await flush();
    assert(e.w.document.getElementById('preferencesStatus').textContent.includes('Could not clear'),'failure not shown');
  });
  await test('popup health is optional, ignores stale credentials and retries failed pages', async () => {
    const store={enabled:true,consentVersion:2,apiKey:'test',keyRevision:'new',resetToken:'reset'};
    const health={kind:'error',code:'errorAuth',status:401,keyRevision:'old',resetToken:'reset',endpoint:'https://api.typesafe.ai/v1/systemone'};
    const e=await makePanel({panel:'popup',store,health}); const doc=e.w.document;
    assert(!doc.getElementById('serviceHealth').textContent.includes('401'),'stale error shown');
    health.keyRevision='new'; await e.setHealth(health);
    assert(!doc.getElementById('retryFailed').hidden && doc.getElementById('serviceHealth').textContent.includes('401'),'request error hidden');
    const threshold=doc.getElementById('threshold'); threshold.focus(); threshold.value='.4';
    await e.setHealth({...health,kind:'ok'}); assert(Number(threshold.value) === .4,'diagnostics clobbered input draft');
    assert(!doc.getElementById('retryFailed').hidden, 'last success hid recovery for other failed posts');
    await e.setHealth(health); doc.getElementById('retryFailed').click(); await flush();
    assert(typeof store.retryToken === 'string' && doc.getElementById('retryFailed').hidden,'retry signal not saved');
    const noHealth=await makePanel({panel:'popup',store,failHealth:true});
    assert(!noHealth.w.document.getElementById('quickSettings').disabled && !noHealth.w.document.body.hidden,'session failure disabled preferences');
  });

  await test('popup error and recovery controls fit the 360px layout in both languages', async () => {
    for (const language of ['en','zh']) {
      const e=await makePanel({panel:'popup',width:360,store:{language,apiKey:'test',enabled:true,consentVersion:2},
        health:{kind:'error',code:'errorAuth',status:401,endpoint:'https://api.typesafe.ai/v1/systemone',keyRevision:'',resetToken:0}});
      const doc=e.w.document;
      assert(doc.documentElement.scrollWidth<=360 && doc.body.scrollWidth<=360,'popup horizontal overflow');
      assert(doc.body.scrollHeight<=600, 'popup exceeds Chrome height');
      assert(!doc.getElementById('retryFailed').hidden && !doc.getElementById('openSettings').hidden, 'recovery/settings hidden');
    }
  });

  document.getElementById('results').textContent = JSON.stringify(results, null, 2);
  document.documentElement.dataset.testResults = encodeURIComponent(JSON.stringify(results));
})().catch(error => {
  document.documentElement.dataset.testResults = encodeURIComponent(JSON.stringify([{ name: 'harness', ok: false, error: error.stack }]));
});
