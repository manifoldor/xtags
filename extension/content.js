/*
 * 内容脚本：提取帖子、贴标签、维护页面内状态和统计。
 *
 * 它**不发请求**——那件事在 background.js 里做，因为内容脚本的 fetch 受 CORS 约束。
 * 这里只负责 DOM 那一半：读状态、渲染标签、决定什么时候该问。
 *
 * 判断和展示是分开的：background 拿回来的四个判断是"是什么"，怎么组合成标签、
 * 什么时候显示由下面的 compose() 决定。持久化缓存由后台独占管理。
 */

(function () {
  "use strict";

  // ── 配置（从后台获取脱敏快照，监听临时存储变化）───────────────────────────
  const CONSENT_VERSION = 2;
  const DEFAULTS = {
    hasKey: false,
    keyRevision: "",
    model: "jev-latest",
    threshold: 0.8,
    showAll: false,
    enabled: false,
    consentVersion: 0,
    apiEndpoint: XtagsService.OFFICIAL_URL,
    consentEndpoint: XtagsService.OFFICIAL_URL,
    skipReplies: true,
    showHud: true,
    resetToken: 0,
    language: "auto",
    retryToken: 0,
  };

  // 内容脚本只接收不含 API key 的临时设置；请求和持久化缓存统一交给后台。
  let HAS_KEY = false;
  let MODEL = "jev-latest";
  let RESET_TOKEN = 0;
  let THRESHOLD = 0.8;
  let SHOW_ALL = false;
  let ENABLED = false;
  let CONSENTED = false;
  const serviceConfig = { apiEndpoint: XtagsService.OFFICIAL_URL, consentEndpoint: XtagsService.OFFICIAL_URL, consentVersion: 0 };
  let SKIP_REPLIES = true;
  let SHOW_HUD = true;

  const MAX_INFLIGHT = 3;
  const CACHE_LIMIT = 3000;
  const MAX_QUEUE = 100;
  const RETRY_DELAYS = [15000, 60000];
  const FULL_TEXT_RETRY_DELAYS = [500, 1500, 3500];

  /**
   * 帖子容器。用 article[data-testid="tweet"] 而不是时间线的 cellInnerDiv——
   * 后者只是"时间线单元格"的包装，推荐页/关注页/用户页碰巧都在时间线里所以能用，
   * 但帖子详情页的主帖未必走同一套结构。article 是每一篇帖子的规范容器。
   */
  const POST_SELECTOR = 'article[data-testid="tweet"]';

  // ── 标签外观 ──────────────────────────────────────────────────────────────
  /**
   * 严重度阶梯，越往下越醒目。
   *
   * 低段三种（灰/绿/青绿）是平级的，颜色只为区分种类，不表示谁更严重；
   * 从"说服"往上，颜色才开始同时承担严重度的含义。
   *
   * 把八种颜色排成一条人眼能读出的严格序列是不现实的，超过四五级就分不出高低。
   * **真正承载含义的是文字，颜色是辅助**——色觉不同或截图转灰度时，读到的信息
   * 不该变。这也是为什么橙和红那两档还额外加了字重。
   */
  const LEVELS = {
    calm: { fg: "#444b50", bg: "#edf0f2", darkFg: "#e0e5e9", darkBg: "#293238", weight: 500 },
    playful: { fg: "#166534", bg: "#e7f3eb", darkFg: "#a7f3b5", darkBg: "#153725", weight: 500 },
    misc: { fg: "#115e59", bg: "#e4f2f0", darkFg: "#99f6e4", darkBg: "#133b37", weight: 500 },
    notice: { fg: "#1e40af", bg: "#e8eefb", darkFg: "#bfdbfe", darkBg: "#182f54", weight: 500 },
    amber: { fg: "#854d0e", bg: "#fff1d6", darkFg: "#fde68a", darkBg: "#3f2e10", weight: 500 },
    violet: { fg: "#6b21a8", bg: "#f1e9fc", darkFg: "#e9d5ff", darkBg: "#36204e", weight: 500 },
    caution: { fg: "#9a3412", bg: "#fff0e5", darkFg: "#fed7aa", darkBg: "#482712", weight: 600 },
    alarm: { fg: "#991b1b", bg: "#fde9e9", darkFg: "#fecaca", darkBg: "#471f25", weight: 600 },
  };

  const i18n = XtagsI18n.create();
  const SIGNALS = [
    { key: "rage_bait", level: "alarm" },
    { key: "undisclosed_ad", level: "caution" },
    { key: "synthetic", level: "violet" },
  ];

  const INTENT_LEVEL = {
    inform: "calm",
    entertain: "playful",
    other: "misc",
    persuade: "notice",
    sell: "amber",
    provoke: "alarm",
  };

  // ── 状态 ──────────────────────────────────────────────────────────────────
  // 只缓存原始概率；每次渲染都应用当前阈值。
  const cache = new Map();
  const cacheText = new Map();
  const knownLong = new Set();
  const fullTextRetries = new Map();
  const inflight = new Map();
  const failed = new Map();
  const skipped = new Set();
  let queue = [];
  let pagePosts = new Map();
  let queueOverflow = false;
  let active = 0;
  let generation = 0;
  let lastContainerCount = 0;
  let booted = false;
  const earlyChanges = {};

  const stats = {
    seen: 0,
    asked: 0,
    labeled: 0,
    skipped: 0,
    failed: 0,
    tokens: 0,
    lastError: "",
  };

  // ── 判断 → 标签 ───────────────────────────────────────────────────────────
  /**
   * 意图（每条都有）+ 触发信号（过了阈值的）。
   *
   * 意图本身不设阈值——它总有一个答案，只是需要读一眼。被阈值把关的是三个信号：
   * 它们决定这条帖子是否被标记为"有问题"。这样调阈值时意图标签稳定不动，只有
   * 警示部分在变，前后对比才看得清。
   */
  function compose(a) {
    const key = a.intent.choice;
    const signals = SIGNALS.map(({ key, level }) => ({ key, level, p: a[key].noul }));
    return {
      intent: i18n.t(key),
      intentLevel: INTENT_LEVEL[key] ?? "calm",
      intentP: a.intent.probabilities[key],
      signals: signals.filter((signal) => signal.p >= THRESHOLD),
      allSignals: signals,
      tip: tooltip(a),
    };
  }

  function tooltip(a) {
    return [
      `${i18n.t("intent")}  ${i18n.t(a.intent.choice)} (${a.intent.choice})   ${i18n.t("confidence")} ${a.intent.confidence.toFixed(3)}`,
      ...SIGNALS.map(({ key }) => `${i18n.t(key)}  ${a[key].noul.toFixed(3)}`),
    ].join("\n");
  }

  // ── 请求（走 background，内容脚本自己 fetch 会被 CORS 挡）──────────────────
  function ask(job) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: "jev-ask",
        requestId: job.requestId, apiEndpoint: serviceConfig.apiEndpoint, id: job.id, isReply: job.isReply, state: job.state, model: MODEL, resetToken: RESET_TOKEN,
      }, (res) => {
        if (chrome.runtime.lastError) return reject(Object.assign(new Error("Background unavailable"), { code: "errorNoResponse", retryable: true }));
        if (!res) return reject(Object.assign(new Error("background did not respond"), { code: "errorNoResponse" }));
        if (!res.ok) return reject(Object.assign(new Error(res.error), { cancelled: res.cancelled, code: res.code, status: res.status, retryable: res.retryable }));
        resolve(res.data);
      });
    });
  }

  function invalidateRequests() {
    generation++;
    queue = [];
    for (const job of inflight.values()) cancelJob(job);
    inflight.clear();
    clearFailures();
    for (const retry of fullTextRetries.values()) if (retry.timer !== null) clearTimeout(retry.timer);
    fullTextRetries.clear();
  }

  function cancelJob(job) {
    if (!job.running || job.cancelled) return;
    job.cancelled = true;
    const failure = failed.get(job.id);
    if (failure) failure.ready = true;
    try {
      chrome.runtime.sendMessage({ type: "jev-cancel", requestId: job.requestId }, () => { void chrome.runtime.lastError; });
    } catch { /* The background also checks settings before sending. */ }
  }

  function clearFailure(id) {
    const entry = failed.get(id);
    if (entry?.timer !== null && entry?.timer !== undefined) clearTimeout(entry.timer);
    failed.delete(id);
  }
  function clearFailures() {
    for (const id of failed.keys()) clearFailure(id);
  }
  function armRetry(id, entry) {
    if (!entry.retryable || entry.attempts >= RETRY_DELAYS.length || entry.timer !== null) return;
    entry.timer = setTimeout(() => {
      entry.timer = null;
      if (failed.get(id) !== entry) return;
      entry.ready = true;
      scan();
    }, RETRY_DELAYS[entry.attempts]);
  }
  function retryFailures(manual = false) {
    for (const [id, entry] of failed) {
      if (!manual && (!entry.retryable || entry.attempts >= RETRY_DELAYS.length)) continue;
      if (entry.timer !== null) clearTimeout(entry.timer);
      entry.timer = null;
      entry.ready = true;
      if (manual) entry.attempts = -1;
    }
    if (booted) scan();
  }
  window.addEventListener("online", () => retryFailures());
  window.addEventListener("pagehide", invalidateRequests);
  window.addEventListener("pageshow", (event) => { if (event.persisted && booted) scan(); });

  function matchesJob(job, record) {
    return record && record.el.isConnected && !record.post.incomplete &&
      !(SKIP_REPLIES && record.reply) && record.post.text === job.state.post.text &&
      (record.post.author ? `@${record.post.author}` : null) === job.state.post.author;
  }
  function currentRecord(job) {
    for (const record of pagePosts.get(job.id) || []) {
      if (!record.el.isConnected) continue;
      const post = extract(record.el);
      const now = post?.id === job.id ? { el: record.el, post, reply: isReply(record.el) } : null;
      if (matchesJob(job, now)) return now;
    }
    return null;
  }
  function pump() {
    if (!CONSENTED || !ENABLED || !HAS_KEY) return;
    while (active < MAX_INFLIGHT && queue.length > 0) {
      const job = queue.shift();
      // DOM nodes can be recycled between a scan and a free request slot.
      if (!currentRecord(job)) {
        if (inflight.get(job.id) === job) inflight.delete(job.id);
        scheduleScan();
        continue;
      }
      job.running = true;
      job.requestId = crypto.randomUUID();
      active++;
      ask(job)
        .then((r) => {
          if (job.cancelled || job.generation !== generation || !CONSENTED || !ENABLED || !HAS_KEY) return;
          if (!currentRecord(job)) { scheduleScan(); return; }
          const verdict = compose(r.answers);
          stats.asked++;
          stats.tokens += r.usage?.input_tokens ?? 0;
          if (verdict.signals.length > 0) stats.labeled++;
          cache.delete(job.id);
          cache.set(job.id, r.answers);
          cacheText.set(job.id, job.state.post.text);
          while (cache.size > CACHE_LIMIT) {
            const oldest = cache.keys().next().value;
            cache.delete(oldest); cacheText.delete(oldest);
          }
          clearFailure(job.id);
          stats.failed = failed.size;
          if (!failed.size) stats.lastError = "";
          if (r.warning) stats.lastError = { code: r.warningCode };
          paint(job.id);
        })
        .catch((e) => {
          if (job.cancelled || job.generation !== generation || e.cancelled) return;
          const entry = { text: job.state.post.text, attempts: job.retryAttempt || 0, ready: false, timer: null,
            code: e.code || "errorRequest", status: e.status,
            retryable: typeof e.retryable === "boolean" ? e.retryable :
              ["errorNetwork", "errorTimeout", "errorNoResponse", "errorQueueFull"].includes(e.code) };
          clearFailure(job.id);
          failed.set(job.id, entry);
          while (failed.size > CACHE_LIMIT) clearFailure(failed.keys().next().value);
          stats.failed = failed.size;
          stats.lastError = { code: entry.code, status: entry.status };
          armRetry(job.id, entry);
          scheduleScan();
        })
        .finally(() => {
          active--;
          if (inflight.get(job.id) === job) inflight.delete(job.id);
          refreshUi();
          pump();
          if (queueOverflow) scheduleScan();
        });
    }
  }

  // ── 提取 ──────────────────────────────────────────────────────────────────
  /**
   * 这条是不是回复。
   *
   * 用**文本前缀**匹配"回复 @xxx"那一行，而不是某个 data-testid——因为 action bar
   * 里那个"回复"按钮的 testid 恰好也叫 reply，按 testid 匹配会把每一条帖子都当成
   * 回复，于是所有标签消失且看不出原因。
   *
   * 代价是依赖界面语言，现在覆盖中英两种。
   */
  const REPLY_PREFIX = /^(Replying to|回复|正在回复)/;

  function belongsToPost(node, article) {
    if (node.closest(POST_SELECTOR) !== article) return false;
    if (node.matches('div[role="link"], [data-testid="quoteTweet"]')) return false;
    for (let parent = node.parentElement; parent && parent !== article; parent = parent.parentElement) {
      if (parent.matches('[role="link"], [data-testid="quoteTweet"]')) return false;
    }
    return true;
  }
  function isReply(el) {
    for (const div of el.querySelectorAll("div")) {
      if (!belongsToPost(div, el) || div.closest('[data-testid="tweetText"], [data-xtags-badge]')) continue;
      if (div.querySelector('[data-testid="tweetText"], article[data-testid="tweet"]')) continue;
      const text = (div.textContent || "").trim();
      if (text.length > 0 && text.length < 200 && REPLY_PREFIX.test(text)) return true;
    }
    return false;
  }

  function extract(el) {
    const textEl = [...el.querySelectorAll('[data-testid="tweetText"]')].find((node) => belongsToPost(node, el));
    if (!textEl) return null;

    let text = textEl.innerText.trim();
    if (!text) return null;

    const statusLink = findTimeAnchor(el);
    const id = statusLink?.getAttribute("href")?.match(/status\/(\d+)/)?.[1];
    if (!id) return null;

    // X often keeps the entire Note Tweet in page data while tweetText contains
    // only the preview. Never send that preview as if it were the whole post.
    let incomplete = false;
    const folded = [...el.querySelectorAll('[data-testid="tweet-text-show-more-link"]')]
      .some((button) => belongsToPost(button, el));
    if (folded || knownLong.has(id)) {
      const token = ++fullTextToken;
      let result = null;
      const receive = (event) => {
        try {
          const data = JSON.parse(event.detail);
          if (data.token === token && data.id === id) result = data.text;
        } catch { /* Ignore invalid page data. */ }
      };
      el.addEventListener("xtags:fulltext-response", receive);
      try {
        el.dispatchEvent(new CustomEvent("xtags:fulltext-request", {
          detail: JSON.stringify({ id, token }),
        }));
      } finally {
        el.removeEventListener("xtags:fulltext-response", receive);
      }
      if (typeof result === "string" && result.length <= 100000 && result.trim()) {
        text = result;
        knownLong.delete(id);
        knownLong.add(id);
        while (knownLong.size > CACHE_LIMIT) knownLong.delete(knownLong.values().next().value);
      } else incomplete = folded;
    }

    // Keep author and body tied to the same outer status link, not a repost attribution.
    const author = statusLink.getAttribute("href").match(/^(?:https:\/\/(?:x|twitter)\.com)?\/([A-Za-z0-9_]{1,15})\/status\//)?.[1] ?? null;

    return { id, text, author, incomplete };
  }

  let fullTextToken = 0;

  // ── 贴标签 ────────────────────────────────────────────────────────────────
  const BADGE_ATTR = "data-xtags-badge";

  function chip(text, level) {
    const s = LEVELS[level] ?? LEVELS.calm;
    const pill = document.createElement("span");
    pill.textContent = text;
    pill.dataset.xtagsLevel = level;
    // 没有竖线、没有边框——只有底色和字色，靠色相和字重区分。
    pill.style.cssText =
      `display:inline-flex;align-items:center;padding:1px 7px;border-radius:3px;` +
      `white-space:nowrap;background:${pageIsDark ? s.darkBg : s.bg};color:${pageIsDark ? s.darkFg : s.fg};` +
      `font-weight:${s.weight};letter-spacing:.01em;`;
    return pill;
  }

  /**
   * 主帖的时间戳链接：header 行里第一个指向 /status/ 且内含 <time> 的 <a>。
   * 取"第一个"是有意的——引用转推里也会有 <time>，但它排在主帖之后。
   */
  function badgeIn(el) {
    return [...el.querySelectorAll(`[${BADGE_ATTR}]`)].find((node) => belongsToPost(node, el));
  }
  function findTimeAnchor(el) {
    for (const a of el.querySelectorAll('a[href*="/status/"]')) {
      if (a.querySelector("time") && belongsToPost(a, el)) return a;
    }
    return null;
  }

  function makeBadge(id, entry) {
    // 放在 header 行里，必须是 inline 的——用 div 会另起一行。
    const wrap = document.createElement("span");
    wrap.setAttribute(BADGE_ATTR, id);
    wrap.title = entry.tip;
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "button");
    wrap.setAttribute("aria-label", i18n.t("labelDetails", { intent: entry.intent, probability: entry.intentP.toFixed(2) }));
    wrap.addEventListener("focus", () => { wrap.style.outline = "2px solid #5985ba"; showTip(wrap, entry.tip); });
    wrap.addEventListener("blur", () => { wrap.style.outline = ""; hideTip(); });
    wrap.addEventListener("mouseenter", () => showTip(wrap, entry.tip));
    wrap.addEventListener("mouseleave", () => { if (document.activeElement !== wrap) hideTip(); });
    wrap.addEventListener("click", (event) => { event.stopPropagation(); event.preventDefault(); showTip(wrap, entry.tip); });
    wrap.addEventListener("keydown", (event) => {
      if (["Enter", " ", "Escape"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        if (event.key === "Escape") hideTip(); else showTip(wrap, entry.tip);
      }
    });
    wrap.lang = i18n.locale === "zh" ? "zh-CN" : "en";
    wrap.style.cssText =
      "display:inline-flex;flex-wrap:wrap;align-items:center;gap:4px;margin-left:8px;max-width:calc(100% - 8px);" +
      "vertical-align:baseline;font:500 11px/1.3 " +
      "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";

    wrap.appendChild(chip(`${entry.intent} ${entry.intentP.toFixed(2)}`, entry.intentLevel));
    for (const s of entry.signals) {
      wrap.appendChild(chip(`${i18n.t(s.key)} ${s.p.toFixed(2)}`, s.level));
    }
    if (SHOW_ALL) {
      for (const { key, p } of entry.allSignals) {
        if (entry.signals.some((signal) => signal.key === key)) continue;
        wrap.appendChild(chip(`${i18n.t(key)} ${p.toFixed(2)}`, "calm"));
      }
    }
    return wrap;
  }

  function showIncomplete(el, id) {
    scheduleFullTextRetry(id);
    const existing = badgeIn(el);
    if (existing?.getAttribute("data-xtags-incomplete") === "true") return;
    existing?.remove();
    const anchor = findTimeAnchor(el);
    if (!anchor?.parentElement) return;
    const badge = document.createElement("span");
    badge.setAttribute(BADGE_ATTR, id);
    badge.setAttribute("data-xtags-incomplete", "true");
    badge.style.cssText = "display:inline-flex;margin-left:8px;font:500 11px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";
    badge.appendChild(chip(i18n.t("fullTextUnavailable"), "calm"));
    anchor.parentElement.insertBefore(badge, anchor.nextSibling);
  }

  function clearFullTextRetry(id) {
    const retry = fullTextRetries.get(id);
    if (retry?.timer !== null && retry?.timer !== undefined) clearTimeout(retry.timer);
    fullTextRetries.delete(id);
  }

  function scheduleFullTextRetry(id) {
    let retry = fullTextRetries.get(id);
    if (!retry) {
      retry = { attempts: 0, timer: null };
      fullTextRetries.set(id, retry);
    }
    if (retry.timer !== null || retry.attempts >= FULL_TEXT_RETRY_DELAYS.length) return;
    const delay = FULL_TEXT_RETRY_DELAYS[retry.attempts++];
    retry.timer = setTimeout(() => {
      retry.timer = null;
      const stillPresent = [...document.querySelectorAll(POST_SELECTOR)].some((article) =>
        findTimeAnchor(article)?.getAttribute("href")?.match(/status\/(\d+)/)?.[1] === id);
      if (!stillPresent) {
        fullTextRetries.delete(id);
        return;
      }
      scan();
    }, delay);
    while (fullTextRetries.size > CACHE_LIMIT) clearFullTextRetry(fullTextRetries.keys().next().value);
  }

  function paintRecord(record, entry) {
    const { el, post, reply } = record;
    if (post.incomplete || cacheText.get(post.id) !== post.text || (SKIP_REPLIES && reply)) return;
    const existing = badgeIn(el);
    existing?.remove();
    const anchor = findTimeAnchor(el);
    if (anchor?.parentElement) anchor.parentElement.insertBefore(makeBadge(post.id, entry), anchor.nextSibling);
  }
  function paint(id) {
    const answers = cache.get(id);
    if (!CONSENTED || !ENABLED || !HAS_KEY || !answers) return;
    const entry = compose(answers);
    for (const record of pagePosts.get(id) || []) {
      if (!record.el.isConnected) continue;
      const post = extract(record.el);
      if (post?.id === id) paintRecord({ el: record.el, post, reply: isReply(record.el) }, entry);
    }
  }
  function clearBadges() {
    hideTip();
    for (const el of document.querySelectorAll(`[${BADGE_ATTR}]`)) el.remove();
  }

  // Each pass extracts the current DOM once, regardless of historical cache size.
  function scan({ repaint = false, request = true } = {}) {
    if (!CONSENTED || !ENABLED || !HAS_KEY) return;
    const containers = document.querySelectorAll(POST_SELECTOR);
    lastContainerCount = containers.length;
    const records = [];
    pagePosts = new Map();
    for (const el of containers) {
      const post = extract(el), reply = isReply(el);
      const existing = badgeIn(el);
      if (existing && (!post || (SKIP_REPLIES && reply) || existing.getAttribute(BADGE_ATTR) !== post.id)) existing.remove();
      if (!post) continue;
      const record = { el, post, reply };
      records.push(record);
      if (!pagePosts.has(post.id)) pagePosts.set(post.id, []);
      pagePosts.get(post.id).push(record);
    }
    // Prune before admitting replacements so recycled bodies can be queued immediately.
    for (const job of inflight.values()) {
      if (job.running && !(pagePosts.get(job.id) || []).some((record) => matchesJob(job, record))) {
        cancelJob(job);
        inflight.delete(job.id);
      }
    }
    queue = queue.filter((job) => {
      if ((pagePosts.get(job.id) || []).some((record) => matchesJob(job, record))) return true;
      if (inflight.get(job.id) === job) inflight.delete(job.id);
      const failure = failed.get(job.id);
      if (failure) failure.ready = true;
      return false;
    });
    queueOverflow = false;
    for (const record of records) {
      const { el, post, reply } = record;
      if (SKIP_REPLIES && reply) {
        skipped.add(post.id);
        while (skipped.size > CACHE_LIMIT) skipped.delete(skipped.values().next().value);
        continue;
      }
      if (post.incomplete) { showIncomplete(el, post.id); continue; }
      clearFullTextRetry(post.id);
      const existing = badgeIn(el);
      if (existing?.getAttribute("data-xtags-incomplete") === "true") existing.remove();
      if (cache.has(post.id) && cacheText.get(post.id) !== post.text) {
        cache.delete(post.id); cacheText.delete(post.id);
        badgeIn(el)?.remove();
      }
      if (cache.has(post.id)) {
        if (repaint || !badgeIn(el)) paintRecord(record, compose(cache.get(post.id)));
        continue;
      }
      if (!request) continue;
      if (failed.has(post.id) && failed.get(post.id).text !== post.text) clearFailure(post.id);
      const failure = failed.get(post.id);
      if (inflight.has(post.id) || (failure && !failure.ready)) continue;
      if (queue.length >= MAX_QUEUE) { queueOverflow = true; continue; }
      const job = { id: post.id, generation, isReply: reply, retryAttempt: failure ? failure.attempts + 1 : 0,
        state: { post: { author: post.author ? `@${post.author}` : null, text: post.text } } };
      if (failure) failure.ready = false;
      inflight.set(post.id, job); stats.seen++; queue.push(job);
    }
    // Prioritize posts near the viewport while keeping a small prefetch queue.
    const distances = new Map(queue.map((job) => {
      const rect = pagePosts.get(job.id)?.[0]?.el.getBoundingClientRect();
      return [job, rect ? Math.max(0, -rect.bottom, rect.top - window.innerHeight) : Infinity];
    }));
    queue.sort((a, b) => distances.get(a) - distances.get(b));
    for (const id of fullTextRetries.keys()) if (!pagePosts.has(id)) clearFullTextRetry(id);
    stats.skipped = skipped.size;
    refreshUi();
    if (request) pump();
  }

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer !== null) return;
    scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 250);
  }

  // ── 面板 + 统计上报 ───────────────────────────────────────────────────────
  let hud = null;

  /**
   * 跟随浏览器的明亮 / 黑暗模式。
   *
   * 为什么用 matchMedia 而不是 @media 媒体查询——HUD 的样式是内联设的
   * （style.cssText），而**内联样式的优先级高于任何选择器**，媒体查询里的规则
   * 根本覆盖不到它。只能在 JS 里改。
   *
   * 顺带白拿一个好处：change 事件会实时跟着系统主题切换，不用刷新页面。
   */
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

  function applyHudTheme() {
    if (!hud) return;
    const dark = pageIsDark;
    hud.style.background = dark ? "rgba(17,24,28,.92)" : "rgba(232,237,239,.96)";
    hud.style.color = dark ? "#e6eff0" : "#2b3438";
    // 浅底面板压在白色页面上需要一点边界感；深底不需要。
    hud.style.boxShadow = dark ? "none" : "0 1px 3px rgba(0,0,0,.10)";
  }

  let pageIsDark = darkQuery.matches;
  let tip = null, tipOwner = null;
  function hideTip() {
    tipOwner?.removeAttribute("aria-describedby");
    tip?.remove(); tip = null; tipOwner = null;
  }
  function showTip(owner, text) {
    hideTip();
    tipOwner = owner;
    tip = document.createElement("div");
    tip.id = "xtags-label-details";
    tip.setAttribute("data-xtags-tip", "");
    tip.setAttribute("role", "tooltip");
    tip.textContent = text;
    tip.style.cssText = "position:fixed;z-index:2147483001;padding:10px;border-radius:6px;white-space:pre-wrap;" +
      "font:13px/1.5 system-ui;max-width:min(320px,calc(100vw - 16px));box-sizing:border-box;" +
      "pointer-events:none;box-shadow:0 2px 8px #0004;" +
      `background:${pageIsDark ? "#202b33" : "#fff"};color:${pageIsDark ? "#f1f5f9" : "#17212a"};`;
    positionTip();
    owner.setAttribute("aria-describedby", tip.id);
    document.body.appendChild(tip);
  }
  function positionTip() {
    const rect = tipOwner.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 328))}px`;
    tip.style.top = `${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 160))}px`;
  }
  document.addEventListener("click", (event) => { if (!event.target.closest?.(`[${BADGE_ATTR}]`)) hideTip(); });
  window.addEventListener("scroll", () => {
    // Keyboard focus can itself scroll the page; keep its description available.
    if (tipOwner?.isConnected && document.activeElement === tipOwner) positionTip();
    else hideTip();
  }, { passive: true });
  function refreshTheme() {
    let dark = darkQuery.matches;
    for (const el of [document.body, document.documentElement]) {
      const match = getComputedStyle(el).backgroundColor.match(/rgba?\(([^)]+)\)/);
      if (!match) continue;
      const values = match[1].split(",").map(Number);
      if (values.length === 4 && values[3] < .9) continue;
      dark = .2126 * values[0] + .7152 * values[1] + .0722 * values[2] < 128;
      break;
    }
    if (dark !== pageIsDark) {
      pageIsDark = dark;
      for (const el of document.querySelectorAll("[data-xtags-level]")) {
        const color = LEVELS[el.dataset.xtagsLevel] || LEVELS.calm;
        el.style.background = dark ? color.darkBg : color.bg;
        el.style.color = dark ? color.darkFg : color.fg;
      }
      hideTip();
    }
    applyHudTheme();
  }
  darkQuery.addEventListener("change", refreshTheme);

  function ensureHud() {
    if (hud && hud.isConnected) return hud;
    hud = document.createElement("div");
    hud.setAttribute("data-xtags-hud", "");
    hud.style.cssText =
      "position:fixed;right:16px;top:16px;z-index:2147483000;padding:8px 12px;" +
      "border-radius:6px;" +
      "font:500 11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;" +
      "pointer-events:none;letter-spacing:.02em;" +
      // pre-wrap 而不是 pre：保留换行的同时允许折行。用 pre 的话，一条 160 字符的
      // 报错会撑出一个上千像素宽的盒子，把面板挤出视口外。
      "white-space:pre-wrap;overflow-wrap:anywhere;max-width:300px;";
    applyHudTheme(); // 颜色不写在上面的 cssText 里，交给这里——避免两处定义打架
    document.body.appendChild(hud);
    return hud;
  }

  function hudText() {
    if (!CONSENTED) return `Xtags\n${i18n.t("errorConsentRequired")}`;
    if (!ENABLED) return `Xtags  ${i18n.t("paused")}`;
    if (!HAS_KEY) return `Xtags\n${i18n.t("errorNoKey")}`;
    const cost = (stats.tokens / 1e6) * 0.042;
    const percent = stats.asked ? ((stats.labeled / stats.asked) * 100).toFixed(0) : 0;
    const lines = [
      "Xtags",
      `${i18n.t("containers")}   ${lastContainerCount}`,
      `${i18n.t("skipped")}   ${stats.skipped}  ← ${i18n.t("replies")}`,
      `${i18n.t("seen")}   ${stats.seen}`,
      `${i18n.t("assessed")}   ${stats.asked}`,
      `${i18n.t("flagged")}   ${stats.labeled}  (${percent}%)`,
      `${i18n.t("failed")}   ${stats.failed}`,
      `${i18n.t("tokens")}  ${stats.tokens.toLocaleString(i18n.locale)}` + (serviceConfig.apiEndpoint === XtagsService.OFFICIAL_URL ? `  ≈$${cost.toFixed(5)}` : ""),
    ];
    if (stats.lastError) lines.push(`\n${i18n.t("lastError")}:\n${i18n.error(stats.lastError).slice(0, 200)}`);
    return lines.join("\n");
  }

  function refreshUi() {
    if (!SHOW_HUD || !document.body) {
      if (hud) {
        hud.remove();
        hud = null;
      }
    } else {
      if (!hud || !hud.isConnected) ensureHud();
      hud.lang = i18n.locale === "zh" ? "zh-CN" : "en";
      const text = hudText();
      if (hud.textContent !== text) hud.textContent = text;
    }
  }

  // ── 配置变化（popup 里改的）───────────────────────────────────────────────
  function threshold(value) {
    const n = Number(value);
    return value !== null && value !== "" && Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.8;
  }

  function applyChanges(changes) {
    const lifecycle = ["hasKey", "keyRevision", "enabled", "consentVersion", "apiEndpoint", "consentEndpoint", "model", "resetToken"].some((k) => changes[k]);
    if (lifecycle) invalidateRequests();
    if (changes.hasKey) HAS_KEY = changes.hasKey.newValue === true;
    if (changes.enabled) ENABLED = changes.enabled.newValue === true;
    for (const key of Object.keys(serviceConfig)) if (changes[key]) serviceConfig[key] = changes[key].newValue ?? DEFAULTS[key];
    CONSENTED = XtagsService.hasConsent(serviceConfig, CONSENT_VERSION);
    if (changes.model) MODEL = changes.model.newValue || "jev-latest";
    if (changes.resetToken) RESET_TOKEN = changes.resetToken.newValue ?? 0;
    if (changes.language) i18n.setPreference(changes.language.newValue);
    if (changes.showAll) SHOW_ALL = !!changes.showAll.newValue;
    if (changes.skipReplies) {
      SKIP_REPLIES = changes.skipReplies.newValue !== false;
      skipped.clear();
      stats.skipped = 0;
    }
    if (changes.showHud) SHOW_HUD = changes.showHud.newValue !== false;
    if (changes.threshold) THRESHOLD = threshold(changes.threshold.newValue);
    if (changes.model || changes.resetToken || changes.apiEndpoint) {
      cache.clear();
      cacheText.clear();
    }
    if (changes.resetToken) {
      skipped.clear();
      for (const key of Object.keys(stats)) stats[key] = key === "lastError" ? "" : 0;
    } else if (lifecycle) {
      stats.failed = 0;
      stats.lastError = "";
    }
    clearBadges();
    refreshUi();
    if (Object.keys(changes).every((key) => key === "language")) {
      scan({ repaint: true, request: false });
    } else {
      if (changes.retryToken) retryFailures(true);
      else scan({ repaint: true });
    }
  }

  chrome.storage.session.onChanged.addListener((changes) => {
    if (!changes.publicConfig) return;
    const before = changes.publicConfig.oldValue ?? {};
    const after = changes.publicConfig.newValue ?? {};
    const settings = Object.fromEntries(Object.keys(DEFAULTS)
      .filter((key) => before[key] !== after[key])
      .map((key) => [key, { oldValue: before[key], newValue: after[key] ?? DEFAULTS[key] }]));
    if (!Object.keys(settings).length) return;
    if (!booted) Object.assign(earlyChanges, settings);
    else applyChanges(settings);
  });

  window.addEventListener("languagechange", () => {
    if (booted && i18n.preference === "auto") {
      clearBadges();
      scan({ repaint: true, request: false });
      refreshUi();
    }
  });

  // 忽略自己的 HUD/标签变动，避免扫描 → 写 DOM → 扫描的反馈循环。
  function ownNode(node) {
    const el = node.nodeType === 1 ? node : node.parentElement;
    return !!el?.closest(`[${BADGE_ATTR}], [data-xtags-hud], [data-xtags-tip]`);
  }

  function onMutations(records) {
    if (records.some((record) => {
      if (ownNode(record.target)) return false;
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (record.type !== "childList") return !!target?.closest(POST_SELECTOR);
      const external = [...record.addedNodes, ...record.removedNodes].filter((node) => !ownNode(node));
      if (!external.length) return false;
      if (target?.closest(POST_SELECTOR)) return true;
      return external.some((node) => node.nodeType === 1 && (node.matches(POST_SELECTOR) || node.querySelector(POST_SELECTOR)));
    })) scheduleScan();
  }

  // ── 启动 ──────────────────────────────────────────────────────────────────
  function loadPublicConfig() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "xtags-config" }, (res) => {
        if (chrome.runtime.lastError) return reject(Object.assign(new Error("Background unavailable"), { code: "errorNoResponse", retryable: true }));
        if (!res?.ok || !res.data) return reject(new Error(res?.error || "settings unavailable"));
        resolve(res.data);
      });
    });
  }

  async function boot() {
    const cfg = { ...DEFAULTS, ...await loadPublicConfig() };
    for (const [key, change] of Object.entries(earlyChanges)) cfg[key] = change.newValue;
    i18n.setPreference(cfg.language);
    HAS_KEY = cfg.hasKey === true;
    MODEL = cfg.model || "jev-latest";
    RESET_TOKEN = cfg.resetToken ?? 0;
    THRESHOLD = threshold(cfg.threshold);
    SHOW_ALL = !!cfg.showAll;
    ENABLED = cfg.enabled === true;
    for (const key of Object.keys(serviceConfig)) serviceConfig[key] = cfg[key];
    CONSENTED = XtagsService.hasConsent(serviceConfig, CONSENT_VERSION);
    SKIP_REPLIES = cfg.skipReplies !== false;
    SHOW_HUD = cfg.showHud !== false;
    booted = true;

    new MutationObserver(onMutations).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["href", "data-testid"],
    });
    const themeObserver = new MutationObserver(refreshTheme);
    for (const el of [document.body, document.documentElement]) themeObserver.observe(el, { attributes: true, attributeFilter: ["style", "class"] });
    refreshTheme();
    refreshUi();
    scan();
  }

  boot().catch((e) => console.warn("[xtags] 初始化失败:", e.message));
})();
