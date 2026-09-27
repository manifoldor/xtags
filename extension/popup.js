const $ = (id) => document.getElementById(id);
const i18n = XtagsI18n.create();
const CONSENT_VERSION = 2;
const DEFAULTS = {
  apiEndpoint: XtagsService.OFFICIAL_URL, consentEndpoint: XtagsService.OFFICIAL_URL,
  apiKey: "", consentVersion: 0, enabled: false, threshold: 0.8,
  keyRevision: "", resetToken: 0, retryToken: 0,
  skipReplies: true, showAll: false, showHud: true, language: "auto",
};
const CHECKBOXES = ["enabled", "skipReplies", "showAll", "showHud"];
const state = { ...DEFAULTS }, earlyChanges = {};
let loaded = false;
let statusMessage = "";
let saving = false;
let serviceHealth = null;

function renderLanguage(restore = false) {
  document.documentElement.lang = i18n.locale === "zh" ? "zh-CN" : "en";
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = i18n.t(el.dataset.i18n);
  $("language").value = i18n.preference;
  $("language").disabled = !loaded || saving;
  $("quickSettings").disabled = !loaded || saving;
  const accepted = XtagsService.hasConsent(state, CONSENT_VERSION);
  const configured = accepted && !!state.apiKey;
  $("enabled").disabled = !configured;
  for (const id of CHECKBOXES) $(id).checked = id === "enabled" ? configured && state.enabled === true : !!state[id];
  if (restore === true || document.activeElement !== $("threshold")) $("threshold").value = state.threshold;
  $("setupNotice").hidden = !loaded || configured;
  $("setupNotice").textContent = i18n.t(accepted ? "setupKey" : "setupConsent");
  $("status").textContent = statusMessage ? i18n.t(statusMessage) : "";
  $("status").hidden = !statusMessage;
  const active = configured && state.enabled;
  const valid = serviceHealth?.endpoint === state.apiEndpoint &&
    (serviceHealth.keyRevision ?? "") === state.keyRevision && (serviceHealth.resetToken ?? 0) === state.resetToken;
  $("serviceHealth").hidden = !loaded || !configured;
  $("serviceHealth").textContent = !active ? i18n.t("paused") : !valid ? i18n.t("healthWaiting") :
    serviceHealth.kind === "ok" ? i18n.t("healthOk") : i18n.error(serviceHealth);
  // The latest successful request does not prove every open post recovered.
  $("retryFailed").hidden = !active;
  $("retryFailed").disabled = saving;
}

async function load() {
  try {
    Object.assign(state, await chrome.storage.local.get(DEFAULTS), earlyChanges);
    i18n.setPreference(state.language);
    loaded = true;
  } catch { statusMessage = "loadFailed"; }
  try { serviceHealth = (await chrome.storage.session.get({ serviceHealth: null })).serviceHealth; }
  catch { /* Optional diagnostics must not disable saved preferences. */ }
  renderLanguage();
  document.body.hidden = false;
}

async function save(values) {
  if (!loaded || saving) return;
  saving = true;
  renderLanguage();
  try {
    await chrome.storage.local.set(values);
    Object.assign(state, values);
    i18n.setPreference(state.language);
    statusMessage = "";
  } catch { statusMessage = "saveFailed"; }
  finally { saving = false; renderLanguage(true); }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session") {
    if (changes.serviceHealth) { serviceHealth = changes.serviceHealth.newValue || null; renderLanguage(); }
    return;
  }
  if (area !== "local") return;
  for (const key of Object.keys(DEFAULTS)) {
    if (!changes[key]) continue;
    state[key] = changes[key].newValue ?? DEFAULTS[key];
    if (!loaded) earlyChanges[key] = state[key];
  }
  i18n.setPreference(state.language);
  renderLanguage();
});
window.addEventListener("languagechange", renderLanguage);
$("language").addEventListener("change", () => save({ language: XtagsI18n.normalize($("language").value) }));
$("threshold").addEventListener("change", () => {
  const value = Number($("threshold").value);
  save({ threshold: Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0.8 });
});
for (const id of CHECKBOXES) $(id).addEventListener("change", () => {
  if (id === "enabled" && (!XtagsService.hasConsent(state, CONSENT_VERSION) || !state.apiKey)) {
    renderLanguage(); return;
  }
  save({ [id]: $(id).checked });
});
$("openSettings").addEventListener("click", async () => {
  try { await chrome.runtime.openOptionsPage(); }
  catch { statusMessage = "openSettingsFailed"; renderLanguage(); }
});
$("retryFailed").addEventListener("click", async () => {
  await save({ retryToken: crypto.randomUUID() });
  if (!statusMessage) { $("serviceHealth").textContent = i18n.t("retryStarted"); $("retryFailed").hidden = true; }
});
load();
