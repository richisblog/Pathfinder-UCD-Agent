import { apiUrl, logout, requireAuthenticated, safeJson } from "./api.js";
import { createTranslator, getStoredLanguage, setStoredLanguage } from "./i18n.js";
import { collegeOptionsMarkup, loadMajorCatalog, majorOptionsForCollege } from "./major-catalog.js";
import { submitProfilePayload } from "./profile-form.js";

const TOTAL_STEPS = 10;
const state = await requireAuthenticated();

if (state) {
  const wizard = document.getElementById("onboardingWizard");
  const stepEl = document.getElementById("wizardStep");
  const progressEl = document.getElementById("wizardProgress");
  const errorEl = document.getElementById("profileError");
  const backBtn = document.getElementById("backStepBtn");
  const nextBtn = document.getElementById("nextStepBtn");
  const profile = state.profile || {};
  const prefs = profile.course_preferences || {};
  let step = 0;
  let language = setStoredLanguage(profile.language || getStoredLanguage());
  let t = createTranslator(language);
  const majorCatalog = await loadMajorCatalog();
  const draft = {
    language,
    international_status: profile.international_status || "prefer_not_to_answer",
    student_type: profile.student_type || "",
    current_major: profile.current_major || "",
    target_major: profile.target_major || "",
    college: profile.college || "",
    entry_term: profile.entry_term || "",
    entry_year: profile.entry_year || "",
    graduation_year: profile.graduation_year || "",
    considering_change_major: Boolean(profile.considering_change_major),
    prior_credit_status: profile.ap_ib_summary ? "yes" : "",
    ap_ib_summary: profile.ap_ib_summary || "",
    formatted_credit_summary: "",
    professional_summary: "",
    summary_loading: false,
    math_placement_score: "",
    chemistry_placement_score: "",
    writing_placement_level: "",
    language_placement_status: "",
    placement_note: profile.placement_summary || "",
    course_preferences: {
      priority: prefs.priority || "",
      max_difficulty: prefs.max_difficulty || "",
      target_units: prefs.target_units || "",
      professor_style: prefs.professor_style || "",
      schedule_preference: prefs.schedule_preference || "",
      self_assessment: prefs.self_assessment || "",
    },
  };

  document.getElementById("logoutBtn").onclick = logout;
  backBtn.addEventListener("click", () => {
    collectCurrentStep();
    if (step > 0) {
      step -= 1;
      render();
    }
  });
  nextBtn.addEventListener("click", async () => {
    collectCurrentStep();
    if (!validateStep()) return;
    if (step < TOTAL_STEPS - 1) {
      step += 1;
      render();
      return;
    }
    const result = await submitProfilePayload(buildPayload(), errorEl, nextBtn, t);
    if (result?.profile_complete) location.href = "/chat";
  });
  wizard.addEventListener("change", event => {
    if (event.target?.name === "language") {
      language = setStoredLanguage(event.target.value);
      draft.language = language;
      t = createTranslator(language);
      render();
    }
    if (event.target?.name === "student_type" && !draft.course_preferences.max_difficulty) {
      draft.course_preferences.max_difficulty = defaultDifficulty(event.target.value);
    }
    if (event.target?.name === "college" && step === 4) {
      collectCurrentStep();
      render();
    }
    if (event.target?.name === "prior_credit_status" && step === 6) {
      collectCurrentStep();
      render();
    }
  });

  render();

  function render() {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    document.title = t("setupEyebrow") + " | Pathfinder UCD";
    progressEl.innerHTML = progressMarkup(step + 1, TOTAL_STEPS);
    backBtn.textContent = t("back");
    backBtn.disabled = step === 0;
    nextBtn.textContent = step === TOTAL_STEPS - 1 ? t("saveStart") : (step === TOTAL_STEPS - 2 ? t("review") : t("next"));
    errorEl.classList.add("hidden");
    updateChrome();
    stepEl.innerHTML = stepMarkup();
  }

  function stepMarkup() {
    const steps = [
      languageStep,
      stageStep,
      internationalStep,
      timelineStep,
      majorStep,
      difficultyStep,
      creditsStep,
      placementStep,
      selfAssessmentStep,
      reviewStep,
    ];
    return steps[step]();
  }

  function languageStep() {
    return shell(t("chooseLanguageTitle"), t("chooseLanguageBody"), `
      <div class="choice-grid">
        ${choice("language", "en", t("english"), draft.language === "en")}
        ${choice("language", "zh", t("chinese"), draft.language === "zh")}
      </div>
      <div class="wizard-note">${t("languageNote")}</div>
    `);
  }

  function stageStep() {
    return shell(t("stageTitle"), t("stageBody"), `
      <div class="choice-stack">
        ${choice("student_type", "freshman", t("freshman"), draft.student_type === "freshman")}
        ${choice("student_type", "transfer", t("transfer"), draft.student_type === "transfer")}
        ${choice("student_type", "continuing", t("continuing"), draft.student_type === "continuing")}
        ${choice("student_type", "prospective", t("prospective"), draft.student_type === "prospective")}
      </div>
      <div class="wizard-note">${t("defaultLight")}<br>${t("defaultModerate")}</div>
    `);
  }

  function internationalStep() {
    return shell(t("internationalTitle"), t("internationalBody"), `
      <div class="choice-stack">
        ${choice("international_status", "yes", t("internationalYes"), draft.international_status === "yes")}
        ${choice("international_status", "no", t("internationalNo"), draft.international_status === "no")}
        ${choice("international_status", "prefer_not_to_answer", t("internationalPreferNot"), draft.international_status === "prefer_not_to_answer")}
      </div>
      <div class="wizard-note">${escapeHtml(t("f1FullTimeNote"))}</div>
    `);
  }

  function timelineStep() {
    return shell(t("timelineTitle"), t("timelineBody"), `
      <div class="field-grid">
        ${field("entry_term", t("entryTerm"), draft.entry_term || "Fall")}
        ${field("entry_year", t("entryYear"), draft.entry_year || "2026", "numeric")}
        ${field("graduation_year", t("gradYear"), draft.graduation_year || "2030", "numeric")}
      </div>
      <div class="timeline-preview">${escapeHtml(draft.entry_term || "Fall")} ${escapeHtml(draft.entry_year || "2026")} -> ${escapeHtml(draft.graduation_year || "2030")}</div>
    `);
  }

  function majorStep() {
    return shell(t("majorTitle"), t("majorBody"), `
      <div class="field-grid">
        ${selectField("college", t("college"), draft.college, collegeOptions(t, draft.college, majorCatalog))}
        ${selectField("current_major", t("currentMajor"), draft.current_major, majorSelectOptions(t, draft.college, draft.current_major, majorCatalog))}
        ${selectField("target_major", t("targetMajor"), draft.target_major, majorSelectOptions(t, draft.college, draft.target_major, majorCatalog))}
      </div>
      ${majorCatalog.unavailable ? `<div class="wizard-note">${escapeHtml(t("majorCatalogUnavailable"))}</div>` : ""}
      <label class="checkbox-card">
        <input name="considering_change_major" type="checkbox" ${draft.considering_change_major ? "checked" : ""}>
        <span>${t("changeMajor")}</span>
      </label>
    `);
  }

  function difficultyStep() {
    const selected = draft.course_preferences.max_difficulty || defaultDifficulty(draft.student_type);
    return shell(t("difficultyTitle"), t("difficultyBody"), `
      <div class="choice-stack">
        ${choice("max_difficulty", "Light", t("light"), selected === "Light", t("lightNote"))}
        ${choice("max_difficulty", "Moderate", t("moderate"), selected === "Moderate", t("moderateNote"))}
        ${choice("max_difficulty", "Challenging is okay", t("challenging"), selected === "Challenging is okay", t("challengingNote"))}
      </div>
      <div class="field-grid">
        ${field("target_units", t("targetUnits"), draft.course_preferences.target_units || "14-15")}
      </div>
      <div class="choice-stack compact">
        ${choice("priority", "", t("priorityNotSure"), !draft.course_preferences.priority, t("priorityNotSureNote"))}
        ${choice("priority", "Balanced", t("balanced"), draft.course_preferences.priority === "Balanced", t("balancedNote"))}
        ${choice("priority", "GPA first", t("gpaFirst"), draft.course_preferences.priority === "GPA first", t("gpaFirstNote"))}
        ${choice("priority", "Learn deeply", t("learnDeeply"), draft.course_preferences.priority === "Learn deeply", t("learnDeeplyNote"))}
        ${choice("priority", "Graduate early", t("graduateEarly"), draft.course_preferences.priority === "Graduate early", t("graduateEarlyNote"))}
        ${choice("priority", "Explore majors", t("exploreMajors"), draft.course_preferences.priority === "Explore majors", t("exploreMajorsNote"))}
      </div>
    `);
  }

  function creditsStep() {
    return shell(t("creditsTitle"), t("creditsBody"), `
      <div class="choice-stack compact">
        ${choice("prior_credit_status", "yes", t("priorCreditYes"), draft.prior_credit_status === "yes")}
        ${choice("prior_credit_status", "no", t("priorCreditNo"), draft.prior_credit_status === "no")}
        ${choice("prior_credit_status", "unsure", t("priorCreditUnsure"), draft.prior_credit_status === "unsure" || !draft.prior_credit_status)}
      </div>
      ${draft.prior_credit_status === "yes" ? `
        ${textarea("ap_ib_summary", t("priorCreditRawLabel"), draft.ap_ib_summary, t("priorCreditRawPlaceholder"))}
        <button class="secondary-btn inline-action" type="button" data-format-credit>${draft.summary_loading ? t("formatting") : t("formatWithModel")}</button>
        ${draft.formatted_credit_summary ? `<div class="review-card compact-summary"><strong>${escapeHtml(t("formattedCreditTitle"))}</strong><p>${escapeHtml(draft.formatted_credit_summary)}</p></div>` : ""}
      ` : ""}
      <div class="wizard-note">${escapeHtml(t("creditContextNote"))}</div>
    `);
  }

  function placementStep() {
    return shell(t("placementTitle"), t("placementBody"), `
      <div class="field-grid">
        ${field("math_placement_score", t("mathPlacementScore"), draft.math_placement_score, "numeric", "", t("mathScorePlaceholder"))}
        ${field("chemistry_placement_score", t("chemistryPlacementScore"), draft.chemistry_placement_score, "numeric", "", t("chemistryScorePlaceholder"))}
        ${selectField("writing_placement_level", t("writingPlacementLevel"), draft.writing_placement_level, writingPlacementOptions(t))}
        ${field("language_placement_status", t("languagePlacementStatus"), draft.language_placement_status, "text", "", t("languagePlacementPlaceholder"))}
      </div>
      ${textarea("placement_note", t("placementLabel"), draft.placement_note, "Math placement done; Chemistry placement pending")}
    `);
  }

  function selfAssessmentStep() {
    return shell(t("selfTitle"), t("selfBody"), `
      ${textarea("self_assessment", t("selfLabel"), draft.course_preferences.self_assessment, t("selfPlaceholder"))}
    `);
  }

  function reviewStep() {
    requestProfessionalSummary();
    return shell(t("reviewTitle"), t("reviewBody"), `
      <div class="review-card">
        <strong>${t("profileSummary")}</strong>
        ${draft.summary_loading ? `<p>${escapeHtml(t("formatting"))}</p>` : ""}
        <div class="formal-summary">${formatSummaryHtml(draft.professional_summary || fallbackProfessionalSummary(draft, t, buildPayload))}</div>
      </div>
    `);
  }

  function collectCurrentStep() {
    const data = new FormData(wizard);
    if (step === 0) {
      draft.language = data.get("language") || draft.language;
      language = setStoredLanguage(draft.language);
      t = createTranslator(language);
    }
    if (step === 1) {
      const nextType = valueOf(data, "student_type");
      if (nextType && nextType !== draft.student_type && !draft.course_preferences.max_difficulty) {
        draft.course_preferences.max_difficulty = defaultDifficulty(nextType);
      }
      draft.student_type = nextType;
    }
    if (step === 2) {
      draft.international_status = valueOf(data, "international_status") || "prefer_not_to_answer";
    }
    if (step === 3) {
      draft.entry_term = valueOf(data, "entry_term");
      draft.entry_year = valueOf(data, "entry_year");
      draft.graduation_year = valueOf(data, "graduation_year");
    }
    if (step === 4) {
      draft.college = valueOf(data, "college");
      draft.current_major = valueOf(data, "current_major");
      draft.target_major = valueOf(data, "target_major");
      draft.considering_change_major = Boolean(data.get("considering_change_major"));
    }
    if (step === 5) {
      draft.course_preferences.max_difficulty = valueOf(data, "max_difficulty") || defaultDifficulty(draft.student_type);
      draft.course_preferences.target_units = valueOf(data, "target_units");
      draft.course_preferences.priority = valueOf(data, "priority");
    }
    if (step === 6) {
      draft.prior_credit_status = valueOf(data, "prior_credit_status") || "unsure";
      draft.ap_ib_summary = draft.prior_credit_status === "yes" ? valueOf(data, "ap_ib_summary") : "";
      if (draft.prior_credit_status !== "yes") draft.formatted_credit_summary = "";
    }
    if (step === 7) {
      draft.math_placement_score = valueOf(data, "math_placement_score");
      draft.chemistry_placement_score = valueOf(data, "chemistry_placement_score");
      draft.writing_placement_level = valueOf(data, "writing_placement_level");
      draft.language_placement_status = valueOf(data, "language_placement_status");
      draft.placement_note = valueOf(data, "placement_note");
    }
    if (step === 8) draft.course_preferences.self_assessment = valueOf(data, "self_assessment");
  }

  function updateChrome() {
    document.querySelector("[data-i18n='setupEyebrow']").textContent = t("setupEyebrow");
    document.querySelector("[data-i18n='setupTitle']").textContent = t("setupTitle");
    document.querySelector("[data-i18n='setupBody']").textContent = t("setupBody");
    document.querySelector("[data-i18n='logout']").textContent = t("logout");
  }

  function validateStep() {
    const message = (() => {
      if (step === 1 && !draft.student_type) return t("chooseStudentTypeError");
      if (step === 4 && !draft.current_major && !draft.target_major) return t("profileValidationError");
      return "";
    })();
    if (!message) return true;
    errorEl.textContent = message;
    errorEl.classList.remove("hidden");
    return false;
  }

  function buildPayload() {
    const placementParts = [];
    if (draft.math_placement_score) placementParts.push(`Math placement score: ${draft.math_placement_score}`);
    if (draft.chemistry_placement_score) placementParts.push(`Chemistry placement score: ${draft.chemistry_placement_score}`);
    if (draft.writing_placement_level) placementParts.push(`Writing/ELWR placement: ${draft.writing_placement_level}`);
    if (draft.language_placement_status) placementParts.push(`Language placement: ${draft.language_placement_status}`);
    if (draft.placement_note) placementParts.push(`Notes: ${draft.placement_note}`);
    return {
      ...draft,
      ap_ib_summary: draft.formatted_credit_summary || draft.ap_ib_summary,
      placement_summary: placementParts.join("; "),
      course_preferences: {
        ...draft.course_preferences,
        max_difficulty: draft.course_preferences.max_difficulty || defaultDifficulty(draft.student_type),
      },
    };
  }

  wizard.addEventListener("click", async event => {
    if (!event.target?.matches("[data-format-credit]")) return;
    collectCurrentStep();
    await formatOnboardingContext({ creditsOnly: true });
    render();
  });

  async function requestProfessionalSummary() {
    if (draft.professional_summary || draft.summary_loading) return;
    draft.summary_loading = true;
    formatOnboardingContext({ creditsOnly: false }).then(() => {
      draft.summary_loading = false;
      if (step === TOTAL_STEPS - 1) render();
    });
  }

  async function formatOnboardingContext({ creditsOnly }) {
    try {
      const res = await fetch(apiUrl("/api/onboarding/format-context"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...buildPayload(), credits_only: creditsOnly }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error || t("formatUnavailable"));
      if (data.formatted_credit_summary) draft.formatted_credit_summary = data.formatted_credit_summary;
      if (data.professional_summary) draft.professional_summary = data.professional_summary;
    } catch {
      if (creditsOnly && draft.ap_ib_summary) draft.formatted_credit_summary = fallbackCreditSummary(draft);
      if (!creditsOnly) draft.professional_summary = fallbackProfessionalSummary(draft, t, buildPayload);
    }
  }

  function shell(title, body, content) {
    return `<div class="step-copy"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p></div>${content}`;
  }

  function progressMarkup(current, total) {
    return `
      <div class="progress-meta"><span>${t("stepCount", { current, total })}</span><strong>${Math.round(current / total * 100)}%</strong></div>
      <div class="progress-rail"><span style="width: ${current / total * 100}%"></span></div>
    `;
  }
}

function defaultDifficulty(studentType) {
  return studentType === "continuing" ? "Moderate" : "Light";
}

function choice(name, value, label, checked, note = "") {
  return `
    <label class="choice-card">
      <input type="radio" name="${name}" value="${escapeHtml(value)}" ${checked ? "checked" : ""}>
      <span><strong>${escapeHtml(label)}</strong>${note ? `<small>${escapeHtml(note)}</small>` : ""}</span>
    </label>
  `;
}

function check(name, label, checked) {
  return `
    <label class="choice-card">
      <input type="checkbox" name="${name}" value="${escapeHtml(label)}" ${checked ? "checked" : ""}>
      <span>${escapeHtml(label)}</span>
    </label>
  `;
}

function field(name, label, value = "", inputmode = "text", list = "", placeholder = "") {
  return `
    <label class="profile-field">
      <span>${escapeHtml(label)}</span>
      <input name="${name}" value="${escapeHtml(value)}" inputmode="${inputmode}" ${list ? `list="${list}"` : ""} ${placeholder ? `placeholder="${escapeHtml(placeholder)}"` : ""}>
    </label>
  `;
}

function selectField(name, label, value = "", options = []) {
  return `
    <label class="profile-field">
      <span>${escapeHtml(label)}</span>
      <select name="${name}">
        ${options.map(option => `
          <option value="${escapeHtml(option.value)}" ${option.value === value ? "selected" : ""}>${escapeHtml(option.label)}</option>
        `).join("")}
      </select>
    </label>
  `;
}

function collegeOptions(t, selectedCollege, catalog) {
  const markup = collegeOptionsMarkup(t, selectedCollege, catalog);
  return Array.from(markup.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g))
    .map(match => ({ value: unescapeHtml(match[1]), label: unescapeHtml(match[2]) }));
}

function writingPlacementOptions(t) {
  return [
    { value: "", label: t("placementNotSure") },
    { value: "ELWR satisfied", label: t("elwrSatisfied") },
    { value: "Need Writing Placement Survey", label: t("writingSurveyNeeded") },
    { value: "UWP 7M / multilingual pathway", label: t("uwp7mPath") },
    { value: "UWP 21 / 22 pathway", label: t("uwp2122Path") },
    { value: "Ready for English Composition", label: t("englishCompositionReady") },
  ];
}

function majorSelectOptions(t, college, selectedValue, catalog) {
  return majorOptionsForCollege(catalog, college, selectedValue, t)
    .map(option => ({
      value: option.value,
      label: option.meta ? `${option.label} (${option.meta})` : option.label,
    }));
}

function textarea(name, label, value = "", placeholder = "") {
  return `
    <label class="profile-field span-all">
      <span>${escapeHtml(label)}</span>
      <textarea name="${name}" rows="6" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>
    </label>
  `;
}

function fallbackCreditSummary(draft) {
  if (!draft.ap_ib_summary) return "";
  return `Student-reported prior credit: ${draft.ap_ib_summary}`;
}

function fallbackProfessionalSummary(draft, t, buildPayload) {
  const rows = [
    `${t("language")}: ${draft.language === "zh" ? "中文" : "English"}`,
    `${t("studentType")}: ${draft.student_type || "-"}`,
    `${t("college")}: ${draft.college || "-"}`,
    `${t("currentMajor")}: ${draft.current_major || "-"}`,
    `${t("targetMajor")}: ${draft.target_major || "-"}`,
    `${t("priority")}: ${draft.course_preferences.priority || t("priorityNotSure")}`,
    `${t("creditsLabel")}: ${draft.formatted_credit_summary || draft.ap_ib_summary || t("priorCreditNo")}`,
    `${t("placementLabel")}: ${buildPayload().placement_summary || "-"}`,
    `${t("selfLabel")}: ${draft.course_preferences.self_assessment || "-"}`,
  ];
  return rows.join("\n");
}

function formatSummaryHtml(summary) {
  return escapeHtml(summary)
    .split(/\n+/)
    .filter(Boolean)
    .map(line => `<p>${line}</p>`)
    .join("");
}

function valueOf(data, key) {
  return String(data.get(key) || "").trim();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function unescapeHtml(value) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}
