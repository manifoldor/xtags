const $ = (id) => document.getElementById(id);
const i18n = XtagsI18n.create();
const CONSENT_VERSION = 2;
const DEFAULTS = {
  apiEndpoint: XtagsService.OFFICIAL_URL,
  consentEndpoint: XtagsService.OFFICIAL_URL,
  apiKey: "",
  keyRevision: "",
  threshold: 0.8,
  model: "jev-latest",
  enabled: false,
  consentVersion: 0,
  skipReplies: true,
  showAll: false,
  showHud: true,
  language: "auto",
};
const CHECKBOXES = ["enabled", "skipReplies", "showAll", "showHud"];
let loaded = false;
let consentBusy = false;
let endpointBusy = false;
let saving = false;
let preferencesMessage = "";
const state = { ...DEFAULTS };
const earlyChanges = {};
let resetMessage = "reset";
let statusMessage = "";
let resetTimer;

function renderConsent() {
  const accepted = XtagsService.hasConsent(state, CONSENT_VERSION);
  const pendingEndpoint = endpointDirty();
  $("language").disabled = !loaded || saving || consentBusy || endpointBusy;
  $("disclosureDetails").hidden = false;
  $("consentPrompt").hidden = accepted;
  $("consentGranted").hidden = !accepted;
  $("grantConsent").disabled = !loaded || consentBusy || endpointBusy || saving || pendingEndpoint || !$("consentCheck").checked;
  $("consentCheck").disabled = !loaded || consentBusy || endpointBusy || saving || pendingEndpoint;
  $("revokeConsent").disabled = !loaded || consentBusy || endpointBusy || saving;
  $("settings").hidden = false;
  $("settings").disabled = !loaded || consentBusy || endpointBusy || saving || pendingEndpoint;
  $("enabled").disabled = !accepted;
  $("enabled").checked = accepted && state.enabled === true;
  $("provider").disabled = !loaded || consentBusy || endpointBusy || saving;
  $("apiEndpoint").disabled = !loaded || consentBusy || endpointBusy || saving;
  $("saveEndpoint").disabled = !loaded || consentBusy || endpointBusy || saving;
  $("endpointField").hidden = $("provider").value !== "custom";
  $("endpointPending").hidden = !pendingEndpoint;
}

function renderLanguage() {
  document.documentElement.lang = i18n.locale === "zh" ? "zh-CN" : "en";
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = i18n.t(el.dataset.i18n);
  $("language").value = i18n.preference;
  $("language").disabled = !loaded || saving || consentBusy || endpointBusy;
  $("preferencesStatus").textContent = preferencesMessage ? i18n.t(preferencesMessage) : "";
  $("preferencesStatus").hidden = !preferencesMessage;
  $("reset").textContent = i18n.t(resetMessage);
  $("status").textContent = statusMessage ? i18n.t(statusMessage) : "";
  $("status").hidden = !statusMessage;
  document.title = i18n.t("settingsTitle");
  $("privacyPolicy").href = i18n.locale === "zh" ? "privacy/privacy.zh-CN.html" : "privacy/privacy.html";
  const custom = state.apiEndpoint !== XtagsService.OFFICIAL_URL;
  document.querySelector('[data-i18n="disclosureSummary"]').textContent = i18n.t(custom ? "disclosureCustomSummary" : "disclosureSummary");
  document.querySelector('[data-i18n="disclosureLimits"]').textContent = i18n.t(custom ? "disclosureCustomLimits" : "disclosureLimits");
  $("currentEndpoint").textContent = state.apiEndpoint;
  $("providerPrivacy").hidden = custom;
  $("getKey").hidden = custom;
  renderConsent();
  const manifest = chrome.runtime.getManifest();
  $("author").textContent = manifest.author || i18n.t("unknownAuthor");
}

async function load() {
  try {
    const cfg = await chrome.storage.local.get(DEFAULTS);
    Object.assign(state, cfg, earlyChanges);
    Object.assign(cfg, state);
    i18n.setPreference(cfg.language);
    loaded = true;
    renderEndpointFields();
    $("apiKey").value = cfg.apiKey || "";
    $("threshold").value = cfg.threshold ?? 0.8;
    $("enabled").checked = cfg.enabled === true;
    $("skipReplies").checked = cfg.skipReplies !== false;
    $("showAll").checked = !!cfg.showAll;
    $("showHud").checked = cfg.showHud !== false;
  } catch {
    statusMessage = "loadFailed";
  }
  renderLanguage();
  document.body.hidden = false;
}

function restoreFields(keys) {
  for (const key of keys) {
    if (CHECKBOXES.includes(key)) $(key).checked = !!state[key];
    else if (key === "apiKey" || key === "threshold") $(key).value = state[key];
  }
}
async function save(settings) {
  if (!loaded || saving) return false;
  saving = true;
  renderConsent();
  const preferences = Object.keys(settings).some((key) => ["apiKey", "threshold", ...CHECKBOXES].includes(key));
  try {
    await chrome.storage.local.set(settings);
    Object.assign(state, settings);
    statusMessage = "";
    if (preferences) preferencesMessage = "settingsSaved";
    return true;
  } catch {
    statusMessage = "saveFailed";
    if (preferences) preferencesMessage = "saveFailed";
    return false;
  } finally {
    // Render committed state on both success and failure, never a failed draft.
    restoreFields(Object.keys(settings));
    saving = false;
    renderLanguage();
  }
}

$("language").addEventListener("change", async () => {
  const preference = XtagsI18n.normalize($("language").value);
  $("language").disabled = true;
  try {
    if (await save({ language: preference })) i18n.setPreference(preference);
  } finally {
    $("language").disabled = false;
    renderLanguage();
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  for (const key of Object.keys(DEFAULTS)) {
    if (!changes[key]) continue;
    const value = changes[key].newValue ?? DEFAULTS[key];
    if (!loaded) earlyChanges[key] = value;
    state[key] = value;
  }
  if (changes.consentVersion || changes.consentEndpoint || changes.apiEndpoint) $("consentCheck").checked = false;
  if (changes.apiEndpoint) renderEndpointFields();
  if (changes.language) i18n.setPreference(state.language);
  for (const id of ["apiKey", "threshold", ...CHECKBOXES]) {
    if (!changes[id]) continue;
    if (CHECKBOXES.includes(id)) $(id).checked = !!state[id];
    else $(id).value = state[id] ?? "";
  }
  renderLanguage();
});

$("consentCheck").addEventListener("change", renderConsent);
function renderEndpointFields() {
  $("provider").value = state.apiEndpoint === XtagsService.OFFICIAL_URL ? "official" : "custom";
  $("apiEndpoint").value = state.apiEndpoint === XtagsService.OFFICIAL_URL ? "" : state.apiEndpoint;
}
function endpointDirty() {
  try {
    return XtagsService.normalize($("provider").value === "official" ? XtagsService.OFFICIAL_URL : $("apiEndpoint").value) !== state.apiEndpoint;
  } catch { return true; }
}
function editEndpoint() { $("consentCheck").checked = false; renderConsent(); }
$("provider").addEventListener("change", editEndpoint);
$("apiEndpoint").addEventListener("input", editEndpoint);
$("saveEndpoint").addEventListener("click", async () => {
  if (!loaded || consentBusy || endpointBusy || saving) return;
  let endpoint;
  try { endpoint = XtagsService.normalize($("provider").value === "official" ? XtagsService.OFFICIAL_URL : $("apiEndpoint").value); }
  catch { statusMessage = "errorInvalidEndpoint"; renderLanguage(); return; }
  endpointBusy = true; renderConsent();
  try {
    // Called directly from a click: Chrome requires a user gesture for host access.
    const allowed = await chrome.permissions.request({ origins: [XtagsService.originPattern(endpoint)] });
    if (!allowed) { statusMessage = "errorEndpointPermission"; return; }
    const previous = state.apiEndpoint;
    if (endpoint !== previous) {
      // Never reuse a credential or consent for a different destination.
      if (!await save({ apiEndpoint: endpoint, apiKey: "", keyRevision: crypto.randomUUID(), consentVersion: 0,
        consentEndpoint: "", enabled: false, resetToken: crypto.randomUUID() })) return;
      $("apiKey").value = ""; $("consentCheck").checked = false;
      if (previous !== XtagsService.OFFICIAL_URL && XtagsService.originPattern(previous) !== XtagsService.originPattern(endpoint)) {
        try { await chrome.permissions.remove({ origins: [XtagsService.originPattern(previous)] }); } catch { /* Access is still gated by the saved endpoint. */ }
      }
    }
    statusMessage = "endpointSaved";
    renderEndpointFields();
  } catch { statusMessage = "errorEndpointPermission"; }
  finally { endpointBusy = false; renderLanguage(); }
});
async function changeConsent(accept) {
  if (!loaded || consentBusy || endpointBusy || saving || (accept && (endpointDirty() || !$("consentCheck").checked))) return;
  const consentEndpoint = state.apiEndpoint;
  consentBusy = true;
  renderConsent();
  // Persist consent and enabled together. Never optimistically enable on a failed write.
  let saved = false;
  try {
    // Re-request access if the user previously revoked it in Chrome.
    if (accept && !await chrome.permissions.request({ origins: [XtagsService.originPattern(consentEndpoint)] })) {
      statusMessage = "errorEndpointPermission";
    } else {
      saved = await save({ consentVersion: accept ? CONSENT_VERSION : 0,
        consentEndpoint: accept ? consentEndpoint : "", enabled: accept });
    }
  } catch { statusMessage = "errorEndpointPermission"; }
  consentBusy = false;
  if (saved) $("consentCheck").checked = false;
  renderLanguage();
}
$("grantConsent").addEventListener("click", () => changeConsent(true));
$("revokeConsent").addEventListener("click", () => changeConsent(false));
window.addEventListener("languagechange", () => {
  if (i18n.preference === "auto") renderLanguage();
});

$("apiKey").addEventListener("change", () => {
  const apiKey = $("apiKey").value.trim();
  if (apiKey !== state.apiKey) save({ apiKey, keyRevision: crypto.randomUUID() });
});
$("threshold").addEventListener("change", () => {
  const value = Number($("threshold").value);
  const threshold = Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0.8;
  $("threshold").value = threshold;
  save({ threshold });
});
for (const id of CHECKBOXES) {
  $(id).addEventListener("change", () => {
    if (id === "enabled" && !XtagsService.hasConsent(state, CONSENT_VERSION)) { renderConsent(); return; }
    save({ [id]: $(id).checked });
  });
}

$("reset").addEventListener("click", async () => {
  if (!loaded || saving || consentBusy || endpointBusy) return;
  clearTimeout(resetTimer);
  saving = true;
  renderLanguage();
  try {
    await new Promise((resolve, reject) => chrome.runtime.sendMessage({ type: "xtags-clear-cache" }, (result) => {
      if (chrome.runtime.lastError || !result?.ok) reject(new Error("Cache reset failed"));
      else resolve();
    }));
    state.enabled = false;
    resetMessage = "resetDone";
    preferencesMessage = "resetDone";
  } catch {
    resetMessage = "resetFailed";
    preferencesMessage = "resetFailed";
  }
  saving = false;
  renderLanguage();
  resetTimer = setTimeout(() => { resetMessage = "reset"; renderLanguage(); }, 1600);
});

(function renderByline() {
  const manifest = chrome.runtime.getManifest();
  $("appname").textContent = manifest.name;
  $("ver").textContent = "v" + manifest.version;
  const url = manifest.homepage_url || "";
  if (url && !/example\.com/.test(url)) {
    const a = $("homepage");
    a.href = url;
    a.textContent = url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    a.hidden = false;
  }
})();
load();
