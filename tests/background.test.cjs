const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const serviceSource = fs.readFileSync(path.join(__dirname, '../extension/service.js'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 5; i++) { await new Promise(resolve => setImmediate(resolve)); for (let j = 0; j < 80; j++) await Promise.resolve(); } };
const cacheEntries = data => Object.fromEntries(Object.entries(data).filter(([key]) => key.startsWith("cacheEntry:")).map(([key, value]) => [key.slice(11), value]));
const answers = (choice = 'inform') => ({
  intent: { choice, confidence: .9, probabilities: { [choice]: .9 } },
  rage_bait: { noul: .7 }, synthetic: { noul: .1 }, undisclosed_ad: { noul: .1 },
});
async function setup(options = {}) {
  const data = options.data ?? { apiKey: 'test-key', model: 'jev-latest', enabled: true, consentVersion: 2, resetToken: 0 };
  const listeners = [], permissionListeners = [], calls = [], permissionChecks = [], timers = new Map();
  const accessLevels = {}, sessionData = {};
  let permissionGranted = options.permissionGranted !== false;
  let serial = 0, message, active = 0, maxActive = 0, failWrites = false;
  const storage = {
    setAccessLevel: async ({ accessLevel }) => { accessLevels.local = accessLevel; },
    get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : Object.keys(keys ?? data))
      .map(k => [k, structuredClone(k in data ? data[k] : Array.isArray(keys) || keys === null ? undefined : keys[k])])),
    remove: async keys => {
      if (failWrites) throw new Error("QUOTA_BYTES");
      const changes = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) if (key in data) { changes[key] = { oldValue: data[key] }; delete data[key]; }
      for (const fn of listeners) fn(changes, "local");
    },
    set: async (obj) => {
      options.onWrite?.(obj);
      if (failWrites && Object.keys(obj).some(key => key.startsWith('cache'))) throw new Error('QUOTA_BYTES');
      const changes = {};
      for (const [key, value] of Object.entries(obj)) {
        if (JSON.stringify(data[key]) === JSON.stringify(value)) continue;
        changes[key] = { oldValue: structuredClone(data[key]), newValue: structuredClone(value) };
        data[key] = structuredClone(value);
      }
      for (const fn of listeners) fn(changes, 'local');
    },
  };
  const session = {
    setAccessLevel: async ({ accessLevel }) => { accessLevels.session = accessLevel; },
    set: async (values) => { Object.assign(sessionData, structuredClone(values)); },
  };
  const context = vm.createContext({
    console: { warn() {} }, AbortController, URL, TextEncoder, TextDecoder, crypto: webcrypto, importScripts() {},
    setTimeout(fn, ms) { timers.set(++serial, { fn, ms }); return serial; },
    clearTimeout(id) { timers.delete(id); },
    chrome: {
      permissions: { contains: async value => { permissionChecks.push(value); return permissionGranted; }, onRemoved: { addListener(fn) { permissionListeners.push(fn); } } },
      runtime: { id: 'xtags-test', onMessage: { addListener(fn) { message = fn; } }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
      storage: { local: storage, session, onChanged: { addListener(fn) { listeners.push(fn); } } },
      action: { setIcon: async () => {} },
    },
    fetch: (url, init) => new Promise((resolve, reject) => {
      active++; maxActive = Math.max(active, maxActive); let done = false;
      const finish = fn => value => { if (done) return; done = true; active--; fn(value); };
      const ok = finish(resolve), fail = finish(reject);
      calls.push({ url, init, raw: ok, respond(body = { answers: answers(), usage: { input_tokens: 100 } }, status = 200, retryAfter = null) {
        ok(new Response(JSON.stringify(body), { status, headers: retryAfter ? { 'Retry-After': retryAfter } : {} }));
      }, fail });
      if (!options.ignoreAbort) init.signal.addEventListener('abort', () => fail(new DOMException('Aborted', 'AbortError')), { once: true });
    }),
  });
  vm.runInContext(serviceSource, context);
  vm.runInContext(source, context);
  await flush();
  return { data, calls, timers, storage, sessionData, accessLevels, permissionChecks,
    async permission(value) { permissionGranted = value; if (!value) for (const fn of permissionListeners) fn({ origins: ["https://proxy.example/*"] }); await flush(); }, get maxActive() { return maxActive; }, set failWrites(v) { failWrites = v; },
    async set(obj) { await storage.set(obj); await flush(); },
    ask(id, extra = {}, sender = {}) {
      return new Promise(resolve => message({ type: 'jev-ask', id, apiEndpoint: data.apiEndpoint, model: data.model ?? 'jev-latest', resetToken: data.resetToken ?? 0,
        state: { post: { author: '@alice', text: `Post ${id}` } }, ...extra },
      { id: 'xtags-test', url: 'https://x.com/home', ...sender }, resolve));
    },
    clearCache(sender = {}) {
      return new Promise(resolve => message({ type: 'xtags-clear-cache' },
        { id: 'xtags-test', url: 'chrome-extension://xtags-test/settings.html', ...sender }, resolve));
    },
    cancel(requestId, sender = {}) {
      return new Promise(resolve => message({ type: 'jev-cancel', requestId },
        { id: 'xtags-test', url: 'https://x.com/home', ...sender }, resolve));
    },
    configMessage(sender = {}) {
      return new Promise(resolve => message({ type: 'xtags-config' },
        { id: 'xtags-test', url: 'https://x.com/home', ...sender }, resolve));
    },
    async tick(ms) {
      const timer = [...timers].find(([, v]) => v.ms === ms);
      assert.ok(timer, `expected timer ${ms}`); timers.delete(timer[0]); timer[1].fn(); await flush();
    },
  };
}

test('persistent storage is trusted-only and content settings never contain the API key', async () => {
  const e = await setup();
  assert.equal(e.accessLevels.local, 'TRUSTED_CONTEXTS');
  assert.equal(e.accessLevels.session, 'TRUSTED_AND_UNTRUSTED_CONTEXTS');
  const response = await e.configMessage();
  assert.equal(response.ok, true);
  assert.equal(response.data.hasKey, true);
  assert.equal(Object.hasOwn(response.data, 'apiKey'), false);
  assert.equal(JSON.stringify(e.sessionData).includes('test-key'), false);
  const pending = e.ask('1'); await flush(); await flush();
  assert.ok(e.calls[0], `request did not start: ${JSON.stringify(e.data)}`);
  assert.equal(e.calls[0].init.headers.Authorization, 'Bearer test-key');
  e.calls[0].respond(); await pending;
  await e.set({ apiKey: 'replacement-key', keyRevision: 'revision-2' });
  assert.equal((await e.configMessage()).data.keyRevision, 'revision-2');
  assert.equal(JSON.stringify(e.sessionData).includes('replacement-key'), false);
  await e.set({ apiKey: '' });
  assert.equal((await e.configMessage()).data.hasKey, false);
  assert.equal(e.sessionData.publicConfig.hasKey, false);
  await e.set({ threshold: 0.42, language: 'zh' });
  assert.equal(e.sessionData.publicConfig.threshold, 0.42);
  assert.equal(e.sessionData.publicConfig.language, 'zh');
  assert.equal((await e.configMessage({ url: 'https://example.com/' })).ok, false);
  assert.equal((await e.configMessage({ id: 'other-extension' })).ok, false);
});

test('global concurrency is limited to three requests across callers', async () => {
  const e = await setup(); const pending = ['1', '2', '3', '4', '5'].map(id => e.ask(id)); await flush();
  assert.equal(e.calls.length, 3);
  e.calls[0].respond(); await flush(); assert.equal(e.calls.length, 4);
  e.calls[1].respond(); e.calls[2].respond(); await flush();
  e.calls[3].respond(); e.calls[4].respond();
  assert.ok((await Promise.all(pending)).every(r => r.ok)); assert.equal(e.maxActive, 3);
});

test('same post in two tabs shares one request and cache survives worker restart', async () => {
  const e = await setup(); const a = e.ask('1'), b = e.ask('1'); await flush(); assert.equal(e.calls.length, 1);
  e.calls[0].respond(); const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.data.usage.input_tokens + rb.data.usage.input_tokens, 100);
  const c = e.ask('2'); await flush(); e.calls[1].respond(); await c;
  assert.deepEqual(Object.keys(cacheEntries(e.data)), ['1', '2']);
  const next = await setup({ data: e.data }); assert.equal((await next.ask('1')).data.cached, true);
  assert.equal((await next.ask('2')).data.cached, true); assert.equal(next.calls.length, 0);
});

test('same post ID with a longer body is classified again and replaces the preview cache', async () => {
  const e = await setup();
  const preview = e.ask('1', { state: { post: { author: '@alice', text: 'Beginning' } } });
  await flush(); e.calls[0].respond({ answers: answers('inform') }); await preview;
  const fullText = 'Beginning, followed by a different conclusion and a sales link';
  const full = e.ask('1', { state: { post: { author: '@alice', text: fullText } } });
  await flush(); assert.equal(e.calls.length, 2);
  assert.equal(JSON.parse(e.calls[1].init.body).state.post.text, fullText);
  e.calls[1].respond({ answers: answers('sell') });
  assert.equal((await full).data.answers.intent.choice, 'sell');
  assert.match(cacheEntries(e.data)['1'].fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(cacheEntries(e.data)).includes(fullText), false);
  const restarted = await setup({ data: e.data });
  assert.equal((await restarted.ask('1', { state: { post: { author: '@alice', text: fullText } } })).data.cached, true);
  const oldBody = restarted.ask('1', { state: { post: { author: '@alice', text: 'Beginning' } } });
  await flush(); assert.equal(restarted.calls.length, 1);
  restarted.calls[0].respond(); await oldBody;
});

test('pause aborts running work, drops queue and rejects new requests', async () => {
  const e = await setup(); const pending = ['1', '2', '3', '4', '5'].map(id => e.ask(id)); await flush();
  await e.set({ enabled: false });
  assert.ok((await Promise.all(pending)).every(r => r.cancelled));
  assert.ok(e.calls.every(c => c.init.signal.aborted)); assert.equal(e.calls.length, 3);
  assert.equal((await e.ask('6')).cancelled, true); assert.equal(e.calls.length, 3);
  await e.set({ enabled: true }); const resumed = e.ask('1'); await flush(); e.calls[3].respond(); assert.equal((await resumed).ok, true);
});

test('reset isolates late responses and old content-script tokens', async () => {
  const e = await setup({ ignoreAbort: true }); const old = e.ask('1'); await flush();
  await e.set({ resetToken: 'new-generation' }); assert.equal((await old).cancelled, true);
  assert.equal((await e.ask('1', { resetToken: 0 })).cancelled, true);
  const current = e.ask('1'); await flush(); e.calls[1].respond({ answers: answers('sell') }); await current;
  e.calls[0].respond({ answers: answers('inform') }); await flush();
  assert.equal(cacheEntries(e.data)['1'].answers.intent.choice, 'sell');
  const next = await setup({ data: e.data }); assert.equal((await next.ask('1')).data.answers.intent.choice, 'sell');
});

test('401 does not retry; correcting credentials allows the same post again', async () => {
  const e = await setup(); const first = e.ask('1'); await flush(); e.calls[0].respond({ error: 'unauthorized' }, 401);
  assert.equal((await first).ok, false); assert.equal(e.calls.length, 1); assert.equal(e.timers.size, 0);
  await e.set({ apiKey: 'corrected-key' }); const second = e.ask('1'); await flush();
  assert.equal(e.calls[1].init.headers.Authorization, 'Bearer corrected-key');
  e.calls[1].respond(); assert.equal((await second).ok, true);
});

test('transient HTTP errors retry with backoff and respect Retry-After', async () => {
  const e = await setup(); const result = e.ask('1'); await flush(); e.calls[0].respond({}, 429, '2'); await flush();
  await e.tick(2000); assert.equal(e.calls.length, 2); e.calls[1].respond(); assert.equal((await result).ok, true);
});

test('pause cancels pending retry timers', async () => {
  const e = await setup(); const result = e.ask('1'); await flush(); e.calls[0].respond({}, 503); await flush();
  await e.set({ enabled: false }); assert.equal((await result).cancelled, true);
  assert.equal(e.timers.size, 0); assert.equal(e.calls.length, 1);
});

test('timeouts have bounded retries and release the job for later attempts', async () => {
  const e = await setup(); const result = e.ask('1'); await flush();
  await e.tick(20000); await e.tick(1000); await e.tick(20000); await e.tick(2000); await e.tick(20000);
  assert.equal((await result).ok, false); assert.equal(e.calls.length, 3); assert.equal(e.timers.size, 0);
  const next = e.ask('1'); await flush(); e.calls[3].respond(); assert.equal((await next).ok, true);
});

test('invalid answers are not cached or retried', async () => {
  const e = await setup(); const result = e.ask('1'); await flush(); e.calls[0].respond({ answers: { intent: {} } });
  assert.match((await result).error, /格式无效/); assert.equal(e.calls.length, 1); assert.equal(cacheEntries(e.data)?.['1'], undefined);
});

test('cache write failure returns a usable result with a visible warning', async () => {
  const e = await setup(); e.failWrites = true; const result = e.ask('1'); await flush(); e.calls[0].respond();
  const r = await result; assert.equal(r.ok, true); assert.match(r.data.warning, /缓存保存失败/);
});

test('stale cache versions and reset generations are discarded on startup', async () => {
  const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ author: '@alice', text: 'Post 1' })));
  const fingerprint = Buffer.from(digest).toString('hex');
  for (const overrides of [{ cacheVersion: 5 }, { cacheResetToken: 'old' }, { cacheModel: 'old-model' }]) {
    const e = await setup({ data: { apiKey: 'test', enabled: true, consentVersion: 2, model: 'jev-latest', resetToken: 0,
      cacheVersion: 6, cacheModel: 'jev-latest', cacheResetToken: 0,
      cache: { '1': { answers: answers(), fingerprint, at: Date.now() } }, ...overrides } });
    const result = e.ask('1'); await flush(); assert.equal(e.calls.length, 1); e.calls[0].respond(); await result;
  }
});

test('invalid senders and payloads cannot start requests', async () => {
  const e = await setup(); assert.equal((await e.ask('1', {}, { url: 'https://example.com/' })).ok, false);
  assert.equal((await e.ask('bad-id')).ok, false);
  assert.equal((await e.ask('1', { state: { post: { author: '@alice', text: 'a'.repeat(100001) } } })).ok, false);
  assert.equal(e.calls.length, 0);
});

test('reset arriving before storage notification cannot read the previous cache', async () => {
  const e = await setup(); const first = e.ask('1'); await flush(); e.calls[0].respond(); await first;
  // Storage has changed, but this worker has not received onChanged yet.
  e.data.resetToken = 'before-event';
  const second = e.ask('1'); await flush();
  assert.equal(e.calls.length, 2); e.calls[1].respond({ answers: answers('sell') });
  assert.equal((await second).data.answers.intent.choice, 'sell');
});

test('settings reread blocks late results even before storage notification', async () => {
  const e = await setup(); const first = e.ask('1'); await flush();
  e.data.enabled = false;
  e.calls[0].respond(); assert.equal((await first).cancelled, true);
  assert.equal(cacheEntries(e.data)?.['1'], undefined);
});

test('language changes preserve active requests and cached probabilities', async () => {
  const e = await setup(); const first = e.ask('1'); await flush();
  await e.set({ language: 'en' }); assert.equal(e.calls[0].init.signal.aborted, false);
  e.calls[0].respond(); assert.equal((await first).ok, true);
  await e.set({ language: 'zh' }); assert.equal((await e.ask('1')).data.cached, true);
  assert.equal(e.calls.length, 1);
});

test('timeout and protocol errors expose stable codes for UI translation', async () => {
  const e = await setup(); const timeout = e.ask('1'); await flush();
  await e.tick(20000); await e.tick(1000); await e.tick(20000); await e.tick(2000); await e.tick(20000);
  assert.equal((await timeout).code, 'errorTimeout');
  const invalid = e.ask('2'); await flush(); e.calls[3].respond({ answers: {} });
  assert.equal((await invalid).code, 'errorInvalidResponse');
});

test('missing, invalid or obsolete consent blocks legacy enabled installs and cached results', async () => {
  for (const consentVersion of [undefined, 0, -1, 1, '2', true]) {
    const e = await setup({ data: { apiKey: 'existing-key', enabled: true, consentVersion,
      cacheVersion: 4, cacheModel: 'jev-latest', cacheResetToken: 0,
      cache: { '1': { answers: answers(), at: Date.now() } } } });
    assert.equal((await e.ask('1')).code, 'errorConsentRequired');
    assert.equal(e.calls.length, 0);
    await e.set({ language: 'en', apiKey: 'changed-key', enabled: true });
    assert.equal((await e.ask('2')).code, 'errorConsentRequired');
    assert.equal(e.calls.length, 0);
  }
});

test('withdrawal alone aborts active work, discards queued and late results; re-consent recovers', async () => {
  const e = await setup({ ignoreAbort: true });
  const pending = ['1', '2', '3', '4'].map(id => e.ask(id)); await flush();
  await e.set({ consentVersion: 0 });
  assert.ok((await Promise.all(pending)).every(r => r.cancelled));
  assert.ok(e.calls.every(c => c.init.signal.aborted));
  for (const call of e.calls) call.respond(); await flush();
  assert.equal(e.calls.length, 3); assert.deepEqual(cacheEntries(e.data), {});
  assert.equal((await e.ask('5')).code, 'errorConsentRequired');
  await e.set({ consentVersion: 2, enabled: true });
  const resumed = e.ask('1'); await flush(); e.calls[3].respond();
  assert.equal((await resumed).ok, true);
});

test('consent reread blocks retries and result writes before onChanged is delivered', async () => {
  const e = await setup(); const pending = e.ask('1'); await flush();
  e.calls[0].respond({}, 503); await flush();
  e.data.consentVersion = 0;
  await e.tick(1000);
  assert.equal((await pending).cancelled, true); assert.equal(e.calls.length, 1);
  await e.set({ consentVersion: 2 });
  const late = e.ask('2'); await flush();
  e.data.consentVersion = 0; e.calls[1].respond();
  assert.equal((await late).cancelled, true); assert.equal(cacheEntries(e.data)?.['2'], undefined);
});

test('consent versions remain aligned across extension contexts', () => {
  const versions = ['background.js', 'content.js', 'popup.js', 'settings.js'].map(file =>
    fs.readFileSync(path.join(__dirname, '../extension', file), 'utf8').match(/const CONSENT_VERSION = (\d+);/)[1]);
  assert.equal(new Set(versions).size, 1);
});

test('custom service sends compatible payload only to the consented URL without cookies or redirects', async () => {
  const apiEndpoint = 'https://proxy.example/custom/systemone';
  const e = await setup({ data: { apiEndpoint, consentEndpoint: apiEndpoint, consentVersion: 2,
    enabled: true, apiKey: 'custom-key' } });
  const pending = e.ask('1'); await flush();
  assert.equal(e.calls.length, 1); const call = e.calls[0];
  assert.equal(call.url, apiEndpoint); assert.equal(call.init.headers.Authorization, 'Bearer custom-key');
  assert.equal(call.init.redirect, 'error'); assert.equal(call.init.credentials, 'omit');
  assert.equal(JSON.parse(call.init.body).state.post.text, 'Post 1');
  assert.deepEqual([...e.permissionChecks[0].origins], ['https://proxy.example/*']);
  call.respond(); assert.equal((await pending).ok, true);
  assert.equal(e.data.cacheEndpoint, apiEndpoint);
  const restarted = await setup({ data: e.data }); assert.equal((await restarted.ask('1')).data.cached, true);
});

test('destination changes invalidate consent, caches, queued work and stale content messages', async () => {
  const e = await setup({ ignoreAbort: true });
  const first = e.ask('1'); await flush(); e.calls[0].respond(); await first;
  const old = e.ask('2'); await flush();
  const apiEndpoint = 'https://proxy.example/v1/systemone';
  await e.set({ apiEndpoint });
  assert.equal((await old).cancelled, true);
  assert.equal((await e.ask('1')).code, 'errorConsentRequired');
  await e.set({ consentEndpoint: apiEndpoint, apiKey: 'custom-key' });
  assert.equal((await e.ask('1', { apiEndpoint: 'https://api.typesafe.ai/v1/systemone' })).cancelled, true);
  const custom = e.ask('1'); await flush(); assert.equal(e.calls.length, 3);
  e.calls[1].respond({ answers: answers('sell') }); e.calls[2].respond(); await custom;
  assert.equal(cacheEntries(e.data)['2'], undefined); assert.equal(e.data.cacheEndpoint, apiEndpoint);
});

test('custom service cannot reuse unmarked official cache or bypass revoked host permission', async () => {
  const apiEndpoint = 'https://proxy.example/v1/systemone';
  const data = { apiEndpoint, consentEndpoint: apiEndpoint, consentVersion: 2, enabled: true,
    apiKey: 'custom-key', cacheVersion: 4, cacheModel: 'jev-latest', cacheResetToken: 0,
    cache: { '1': { answers: answers(), at: Date.now() } } };
  const blocked = await setup({ data: structuredClone(data), permissionGranted: false });
  assert.equal((await blocked.ask('1')).code, 'errorEndpointPermission'); assert.equal(blocked.calls.length, 0);
  const e = await setup({ data, ignoreAbort: true }); const pending = e.ask('1'); await flush();
  assert.equal(e.calls.length, 1); await e.permission(false);
  assert.equal((await pending).cancelled, true); assert.ok(e.calls[0].init.signal.aborted);
  e.calls[0].respond(); await flush();
  assert.equal((await e.ask('1')).code, 'errorEndpointPermission'); assert.equal(e.calls.length, 1);
});

test('provider extras are stripped before returning, caching and legacy migration', async () => {
  const e = await setup();
  const dirty = answers();
  dirty.debug = { authorization: 'secret-echo', text: 'entire post' };
  dirty.intent.prompt = 'secret-echo'; dirty.intent.probabilities.extra = .9;
  dirty.rage_bait.explanation = 'secret-echo';
  const pending = e.ask('1'); await flush();
  e.calls[0].respond({ answers: dirty, debug: 'secret-echo', usage: { input_tokens: 7, key: 'secret-echo' } });
  const result = await pending;
  assert.equal(JSON.stringify(result).includes('secret-echo'), false);
  assert.deepEqual(structuredClone(result.data.answers), answers());
  const entry = cacheEntries(e.data)['1'];
  assert.deepEqual(entry.answers, answers());
  const legacy = { ...e.data, cache: { '1': { ...entry, answers: dirty, debug: 'secret-echo' } } };
  delete legacy['cacheEntry:1'];
  const migrated = await setup({ data: legacy });
  assert.equal((await migrated.ask('1')).data.cached, true);
  assert.equal(JSON.stringify(migrated.data).includes('secret-echo'), false);
  assert.equal(Object.hasOwn(migrated.data, 'cache'), false);
});

test('HTTP error body is cancelled unread and never leaks into response or health', async () => {
  const e = await setup(); const pending = e.ask('1'); await flush();
  let cancelled = false;
  e.calls[0].raw({ ok: false, status: 401, headers: new Headers(), body: {
    cancel: async () => { cancelled = true; },
    getReader: () => { throw new Error('must not read Bearer test-key'); },
  }, text: () => { throw new Error('must not read Bearer test-key'); } });
  const result = await pending;
  assert.equal(cancelled, true); assert.equal(result.code, 'errorAuth');
  assert.equal(result.status, 401); assert.equal(result.retryable, false);
  assert.equal(e.calls.length, 1);
  assert.equal(JSON.stringify([result, e.sessionData]).includes('test-key'), false);
  assert.equal(e.sessionData.serviceHealth.code, 'errorAuth');
});

test('network exception messages are never copied to content or diagnostics', async () => {
  const e = await setup(); const pending = e.ask('1'); await flush();
  for (let i = 0; i < 3; i++) {
    e.calls[i].fail(new Error('Bearer test-key provider debugging'));
    await flush(); if (i < 2) await e.tick(1000 * 2 ** i);
  }
  const result = await pending;
  assert.equal(result.code, 'errorNetwork'); assert.equal(result.retryable, true);
  assert.equal(JSON.stringify([result, e.sessionData]).includes('test-key'), false);
});

test('successful responses have a 64 KiB byte limit including streamed bodies', async () => {
  for (const declared of [false, true]) {
    const e = await setup(); const pending = e.ask('1'); await flush();
    let cancelled = false, reads = 0;
    const stream = new ReadableStream({
      pull(controller) { reads++; controller.enqueue(new Uint8Array(20000)); },
      cancel() { cancelled = true; },
    });
    e.calls[0].raw(new Response(stream, { headers: declared ? { 'Content-Length': '1000000' } : {} }));
    const result = await pending;
    assert.equal(result.code, 'errorResponseTooLarge'); assert.equal(result.retryable, false);
    assert.equal(cancelled, true); assert.ok(reads <= 5);
    assert.equal(e.calls.length, 1); assert.equal(Object.keys(cacheEntries(e.data)).length, 0);
  }
});

test('malformed JSON is not retried and does not echo the payload', async () => {
  const e = await setup(); const pending = e.ask('1'); await flush();
  e.calls[0].raw(new Response('Bearer test-key invalid JSON'));
  const result = await pending;
  assert.equal(result.code, 'errorInvalidResponse'); assert.equal(result.retryable, false);
  assert.equal(JSON.stringify(result).includes('test-key'), false); assert.equal(e.calls.length, 1);
});

test('one hundred successful posts persist one hundred records, not 5050', async () => {
  let recordWrites = 0;
  const e = await setup({ onWrite: obj => {
    assert.equal(Object.hasOwn(obj, 'cache'), false);
    recordWrites += Object.keys(obj).filter(k => k.startsWith('cacheEntry:')).length;
  } });
  for (let i = 1; i <= 100; i++) {
    const pending = e.ask(String(i)); await flush(); e.calls[i - 1].respond(); await pending;
  }
  assert.equal(recordWrites, 100); assert.equal(Object.keys(cacheEntries(e.data)).length, 100);
  const restarted = await setup({ data: e.data });
  assert.equal((await restarted.ask('100')).data.cached, true); assert.equal(restarted.calls.length, 0);
});

test('reply setting cancels queued and running replies without cancelling normal posts', async () => {
  const e = await setup(); await e.set({ skipReplies: false });
  const running = e.ask('1', { isReply: true }), normal = [e.ask('2'), e.ask('3')], queued = e.ask('4', { isReply: true });
  await flush(); assert.equal(e.calls.length, 3);
  await e.set({ skipReplies: true });
  assert.equal((await running).cancelled, true); assert.equal((await queued).cancelled, true);
  assert.equal(e.calls[0].init.signal.aborted, true);
  e.calls[1].respond(); e.calls[2].respond(); assert.ok((await Promise.all(normal)).every(r => r.ok));
  assert.equal(e.calls.length, 3); assert.equal((await e.ask('5', { isReply: true })).cancelled, true);
});

test('trusted cache reset pauses, aborts and durably clears while preserving the key', async () => {
  const e = await setup({ ignoreAbort: true });
  const done = e.ask('1'); await flush(); e.calls[0].respond(); await done;
  const late = e.ask('2'); await flush();
  assert.equal((await e.clearCache({ url: 'https://x.com/home' })).ok, false);
  assert.equal(e.data.enabled, true);
  assert.equal((await e.clearCache()).ok, true);
  assert.equal(e.data.enabled, false); assert.equal(e.data.apiKey, 'test-key');
  assert.equal((await late).cancelled, true);
  e.calls[1].respond(); await flush();
  assert.equal(Object.keys(cacheEntries(e.data)).length, 0);
  assert.equal(e.data.cacheResetToken, e.data.resetToken);
  const restarted = await setup({ data: e.data });
  assert.equal((await restarted.ask('1')).cancelled, true); assert.equal(restarted.calls.length, 0);
});

test('failed cache reset is reported and cannot resume uploading', async () => {
  const e = await setup(); const pending = e.ask('1'); await flush(); e.calls[0].respond(); await pending;
  e.failWrites = true;
  const result = await e.clearCache();
  assert.equal(result.ok, false); assert.equal(result.code, 'errorCacheWrite');
  assert.equal(e.data.enabled, false); assert.equal((await e.ask('2')).cancelled, true);
  e.failWrites = false; assert.equal((await e.clearCache()).ok, true);
  assert.equal(Object.keys(cacheEntries(e.data)).length, 0);
});

test('cancel removes a background-queued consumer before any upload', async () => {
  const e = await setup();
  const active = ['1','2','3'].map(id => e.ask(id));
  const queued = e.ask('4', {requestId:'queued'}); await flush();
  assert.equal(e.calls.length, 3);
  await e.cancel('queued'); assert.equal((await queued).cancelled, true);
  e.calls.forEach(call => call.respond()); await Promise.all(active); await flush();
  assert.equal(e.calls.length, 3);
});

test('cancellation is scoped to document and does not abort other shared consumers', async () => {
  const e = await setup();
  const a = {tab:{id:1},documentId:'a'}, b = {tab:{id:2},documentId:'b'};
  const first = e.ask('1',{requestId:'same-id'},a), second = e.ask('1',{requestId:'same-id'},b); await flush();
  assert.equal(e.calls.length, 1);
  await e.cancel('same-id',{tab:{id:1},documentId:'different-document'});
  assert.equal(e.calls[0].init.signal.aborted, false);
  await e.cancel('same-id',a); assert.equal((await first).cancelled, true);
  assert.equal(e.calls[0].init.signal.aborted, false);
  e.calls[0].respond(); assert.equal((await second).ok, true);
});

test('last consumer cancellation aborts and immediate cancellation wins the hashing race', async () => {
  const e = await setup();
  const pending = e.ask('1',{requestId:'active'}); await flush();
  await e.cancel('active'); assert.equal((await pending).cancelled, true);
  assert.equal(e.calls[0].init.signal.aborted, true);
  const early = e.ask('2',{requestId:'early'}); await e.cancel('early');
  assert.equal((await early).cancelled, true); await flush();
  assert.equal(e.calls.length, 1); assert.equal(Object.keys(cacheEntries(e.data)).length, 0);
});

test('startup prunes cache count and byte budget and keeps newest valid records', async () => {
  const data = { apiKey:'test', enabled:true, consentVersion:2, model:'jev-latest', resetToken:0,
    cacheVersion:6, cacheModel:'jev-latest', cacheResetToken:0 };
  for(let i=1;i<=3002;i++) data['cacheEntry:'+i] = { answers: answers(), fingerprint:'a'.repeat(64), at:i };
  data['cacheEntry:bad']={answers:answers(),fingerprint:'a'.repeat(64),at:999999};
  const e=await setup({data}); const entries=cacheEntries(e.data);
  assert.equal(Object.keys(entries).length,3000);
  assert.equal(entries['1'],undefined); assert.equal(entries['2'],undefined); assert.ok(entries['3002']);
  assert.equal(Object.hasOwn(e.data,'cacheEntry:bad'),false);
  assert.ok(Buffer.byteLength(JSON.stringify(entries))<=2*1024*1024);
});
