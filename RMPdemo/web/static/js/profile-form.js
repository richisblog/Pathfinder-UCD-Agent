import { apiUrl, safeJson } from "./api.js";

export function collectProfileForm(form) {
  const data = new FormData(form);
  return {
    language: valueOf(data, "language") || "en",
    international_status: valueOf(data, "international_status") || "prefer_not_to_answer",
    student_type: valueOf(data, "student_type"),
    current_major: valueOf(data, "current_major"),
    target_major: valueOf(data, "target_major"),
    college: valueOf(data, "college"),
    entry_term: valueOf(data, "entry_term"),
    entry_year: valueOf(data, "entry_year"),
    graduation_year: valueOf(data, "graduation_year"),
    considering_change_major: Boolean(data.get("considering_change_major")),
    ap_ib_summary: valueOf(data, "ap_ib_summary"),
    placement_summary: valueOf(data, "placement_summary"),
    course_preferences: {
      priority: valueOf(data, "priority"),
      max_difficulty: valueOf(data, "max_difficulty"),
      target_units: valueOf(data, "target_units"),
      professor_style: valueOf(data, "professor_style"),
      schedule_preference: valueOf(data, "schedule_preference"),
      self_assessment: valueOf(data, "self_assessment"),
    },
  };
}

export function populateProfileForm(form, profile = {}) {
  const preferences = profile.course_preferences || {};
  setField(form, "language", profile.language || preferences.language || "en");
  setField(form, "international_status", profile.international_status || "prefer_not_to_answer");
  setField(form, "student_type", profile.student_type);
  setField(form, "current_major", profile.current_major);
  setField(form, "target_major", profile.target_major);
  setField(form, "college", profile.college);
  setField(form, "entry_term", profile.entry_term);
  setField(form, "entry_year", profile.entry_year);
  setField(form, "graduation_year", profile.graduation_year);
  setField(form, "ap_ib_summary", profile.ap_ib_summary);
  setField(form, "placement_summary", profile.placement_summary);
  setField(form, "priority", preferences.priority);
  setField(form, "max_difficulty", preferences.max_difficulty);
  setField(form, "target_units", preferences.target_units);
  setField(form, "professor_style", preferences.professor_style);
  setField(form, "schedule_preference", preferences.schedule_preference);
  setField(form, "self_assessment", preferences.self_assessment);
  const changeMajor = form.elements.considering_change_major;
  if (changeMajor) changeMajor.checked = Boolean(profile.considering_change_major);
}

export async function submitProfileForm(form, errorEl, t = null) {
  hideFormError(errorEl);
  const payload = collectProfileForm(form);
  return submitProfilePayload(payload, errorEl, form.querySelector("button[type='submit']"), t);
}

export async function submitProfilePayload(payload, errorEl, submitButton = null, t = null) {
  hideFormError(errorEl);
  if (!payload.student_type || (!payload.current_major && !payload.target_major)) {
    showFormError(errorEl, translate(t, "profileValidationError", "Please provide your student type and at least one current or target major."));
    return null;
  }
  if (submitButton) submitButton.disabled = true;
  try {
    const res = await fetch(apiUrl("/api/profile"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || translate(t, "profileSaveFailed", "Profile save failed"));
    return data;
  } catch (error) {
    showFormError(errorEl, error.message);
    return null;
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

function translate(t, key, fallback) {
  return typeof t === "function" ? t(key) : fallback;
}

function valueOf(data, key) {
  return String(data.get(key) || "").trim();
}

function setField(form, name, value) {
  const field = form.elements[name];
  if (field) field.value = value || "";
}

function showFormError(errorEl, message) {
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
}

function hideFormError(errorEl) {
  if (errorEl) errorEl.classList.add("hidden");
}
