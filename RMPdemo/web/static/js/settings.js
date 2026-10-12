import { apiUrl, logout, requireAuthenticated, safeJson } from "./api.js";
import { applyStaticTranslations, createTranslator, getStoredLanguage, setStoredLanguage } from "./i18n.js";
import { setupMajorCatalogFilters } from "./major-catalog.js";
import { populateProfileForm, submitProfileForm } from "./profile-form.js";

const state = await requireAuthenticated();
if (state) {
  const form = document.getElementById("profileForm");
  const errorEl = document.getElementById("profileError");
  const llmForm = document.getElementById("llmSettingsForm");
  const llmErrorEl = document.getElementById("llmSettingsError");
  const llmKeyMetaEl = document.getElementById("llmKeyMeta");
  const deleteAccountBtn = document.getElementById("deleteAccountBtn");
  const deleteAccountErrorEl = document.getElementById("deleteAccountError");
  let language = setStoredLanguage(state.profile?.language || getStoredLanguage());
  let t = createTranslator(language);
  applyStaticTranslations(document, language);
  document.title = t("settingsPageTitle");
  populateProfileForm(form, state.profile || {});
  if (form.elements.college && state.profile?.college) {
    form.elements.college.dataset.savedValue = state.profile.college;
  }
  await setupMajorCatalogFilters(form, { datalistId: "settingsMajorOptions", t });
  await loadLlmSettings(llmForm, llmKeyMetaEl, t);

  document.getElementById("logoutBtn").onclick = logout;
  form.elements.language?.addEventListener("change", async event => {
    language = setStoredLanguage(event.target.value);
    t = createTranslator(language);
    applyStaticTranslations(document, language);
    document.title = t("settingsPageTitle");
    await setupMajorCatalogFilters(form, { datalistId: "settingsMajorOptions", t });
    await loadLlmSettings(llmForm, llmKeyMetaEl, t);
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const result = await submitProfileForm(form, errorEl, t);
    if (result?.profile_complete) location.href = "/chat";
  });
  llmForm.addEventListener("submit", async event => {
    event.preventDefault();
    await saveLlmSettings(llmForm, llmErrorEl, llmKeyMetaEl, t);
  });
  deleteAccountBtn.addEventListener("click", async () => {
    await deleteAccountData(deleteAccountBtn, deleteAccountErrorEl, t);
  });
}

async function loadLlmSettings(form, metaEl, t) {
  const res = await fetch(apiUrl("/api/settings/llm"));
  const data = await safeJson(res);
  const settings = data.settings || {};
  setField(form, "mode", settings.mode || "platform_default");
  setField(form, "provider", settings.provider || "platform");
  setField(form, "base_url", settings.base_url || "");
  setField(form, "model", settings.model || "");
  describeKey(metaEl, settings, t);
}

async function saveLlmSettings(form, errorEl, metaEl, t) {
  errorEl.classList.add("hidden");
  const data = new FormData(form);
  const payload = {
    mode: valueOf(data, "mode"),
    provider: valueOf(data, "provider"),
    base_url: valueOf(data, "base_url"),
    model: valueOf(data, "model"),
    api_key: valueOf(data, "api_key"),
  };
  try {
    const res = await fetch(apiUrl("/api/settings/llm"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await safeJson(res);
    if (!res.ok) throw new Error(result.error || t("unableSaveModel"));
    form.elements.api_key.value = "";
    describeKey(metaEl, result.settings || {}, t);
  } catch (error) {
    errorEl.textContent = error.message;
    errorEl.classList.remove("hidden");
  }
}

function describeKey(metaEl, settings, t) {
  if (settings.mode === "user_provider" && settings.api_key_last_four) {
    metaEl.textContent = t("savedKeyEnding", { lastFour: settings.api_key_last_four });
  } else if (settings.mode === "user_provider") {
    metaEl.textContent = t("addOwnKey");
  } else {
    metaEl.textContent = t("usingPlatformQuota");
  }
}

function valueOf(data, key) {
  return String(data.get(key) || "").trim();
}

function setField(form, name, value) {
  const field = form.elements[name];
  if (field) field.value = value || "";
}

async function deleteAccountData(button, errorEl, t) {
  errorEl.classList.add("hidden");
  const confirmation = prompt(t("deleteAccountPrompt"));
  if (confirmation !== "DELETE") return;
  button.disabled = true;
  try {
    const res = await fetch(apiUrl("/api/account"), {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation: "DELETE" }),
    });
    const result = await safeJson(res);
    if (!res.ok) throw new Error(result.error || t("unableDeleteAccount"));
    location.href = "/login";
  } catch (error) {
    errorEl.textContent = error.message;
    errorEl.classList.remove("hidden");
    button.disabled = false;
  }
}
