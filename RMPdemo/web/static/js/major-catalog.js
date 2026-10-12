import { apiUrl } from "./api.js";

export const OFFICIAL_COLLEGES = [
  "College of Agricultural and Environmental Sciences",
  "College of Biological Sciences",
  "College of Engineering",
  "College of Letters and Science",
  "Graduate School of Management",
];

let cachedCatalog = null;

export async function loadMajorCatalog() {
  if (cachedCatalog) return cachedCatalog;
  try {
    const res = await fetch(apiUrl("/api/majors/catalog"));
    if (!res.ok) throw new Error("Major catalog unavailable");
    const data = await res.json();
    cachedCatalog = normalizeCatalog(data);
  } catch {
    cachedCatalog = {
      colleges: OFFICIAL_COLLEGES,
      majors_by_college: {},
      allMajors: [],
      total_majors: 0,
      unavailable: true,
    };
  }
  return cachedCatalog;
}

export function collegeOptionsMarkup(t, selectedCollege = "", catalog = null) {
  const colleges = catalog?.colleges?.length ? catalog.colleges : OFFICIAL_COLLEGES;
  return [
    `<option value="">${escapeHtml(t("notSure"))}</option>`,
    ...colleges.map(college => (
      `<option value="${escapeHtml(college)}" ${college === selectedCollege ? "selected" : ""}>${escapeHtml(college)}</option>`
    )),
  ].join("");
}

export async function setupMajorCatalogFilters(form, {
  t,
  currentName = "current_major",
  targetName = "target_major",
  collegeName = "college",
} = {}) {
  const catalog = await loadMajorCatalog();
  const collegeSelect = form.elements[collegeName];
  const currentInput = form.elements[currentName];
  const targetInput = form.elements[targetName];

  const selectedCollege = collegeSelect?.value || collegeSelect?.dataset.savedValue || "";
  if (collegeSelect) {
    collegeSelect.innerHTML = collegeOptionsMarkup(t, selectedCollege, catalog);
    collegeSelect.value = selectedCollege;
  }

  const render = () => {
    renderMajorField(currentInput, catalog, collegeSelect?.value || "", currentInput?.value || "", t);
    renderMajorField(targetInput, catalog, collegeSelect?.value || "", targetInput?.value || "", t);
    updateMajorNotes(form, catalog, t, currentName, targetName, collegeName);
  };

  collegeSelect?.addEventListener("change", () => {
    delete collegeSelect.dataset.savedValue;
    render();
  });
  currentInput?.addEventListener("input", render);
  targetInput?.addEventListener("input", render);
  render();

  const warning = form.querySelector("[data-major-catalog-warning]");
  if (warning) {
    warning.textContent = catalog.unavailable ? t("majorCatalogUnavailable") : "";
    warning.classList.toggle("hidden", !catalog.unavailable);
  }
  return catalog;
}

export function renderMajorDatalist(datalist, catalog, college, savedValues = [], t = key => key) {
  if (!datalist) return;
  const majors = majorsForCollege(catalog, college);
  const names = new Set(majors.map(major => major.full_name));
  const options = [
    { value: t("notSure"), label: "" },
    ...majors.map(major => ({
      value: major.full_name,
      label: major.major_code ? `${major.major_code} · ${major.college_en}` : major.college_en,
    })),
  ];

  savedValues
    .filter(Boolean)
    .filter(value => !names.has(value) && value !== t("notSure"))
    .forEach(value => options.unshift({ value, label: t("savedOutsideCollege") }));

  datalist.innerHTML = options
    .map(option => `<option value="${escapeHtml(option.value)}" label="${escapeHtml(option.label)}"></option>`)
    .join("");
}

export function majorOptionsForCollege(catalog, college, selectedValue = "", t = key => key) {
  const majors = majorsForCollege(catalog, college);
  const names = new Set(majors.map(major => major.full_name));
  const options = [
    { value: "", label: t("selectOne"), meta: "" },
    { value: t("notSure"), label: t("notSure"), meta: "" },
    ...majors.map(major => ({
      value: major.full_name,
      label: major.full_name,
      meta: major.major_code ? `${major.major_code} · ${major.college_en}` : major.college_en,
    })),
  ];
  if (selectedValue && !names.has(selectedValue) && selectedValue !== t("notSure")) {
    options.splice(1, 0, {
      value: selectedValue,
      label: selectedValue,
      meta: t("savedOutsideCollege"),
    });
  }
  return options;
}

function renderMajorField(field, catalog, college, selectedValue, t) {
  if (!field || field.tagName !== "SELECT") return;
  const options = majorOptionsForCollege(catalog, college, selectedValue, t);
  field.innerHTML = options.map(option => {
    const label = option.meta ? `${option.label} (${option.meta})` : option.label;
    return `<option value="${escapeHtml(option.value)}" ${option.value === selectedValue ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
  field.value = selectedValue;
}

export function majorsForCollege(catalog, college) {
  if (!catalog) return [];
  if (!college) return catalog.allMajors || [];
  return catalog.majors_by_college?.[college] || [];
}

function normalizeCatalog(data) {
  const majorsByCollege = data?.majors_by_college || {};
  const colleges = Array.isArray(data?.colleges)
    ? [...data.colleges].sort((a, b) => a.localeCompare(b))
    : OFFICIAL_COLLEGES;
  const allMajors = Object.values(majorsByCollege)
    .flat()
    .sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || "")));
  return {
    colleges,
    majors_by_college: majorsByCollege,
    allMajors,
    total_majors: Number(data?.total_majors || allMajors.length),
  };
}

function updateMajorNotes(form, catalog, t, currentName, targetName, collegeName) {
  [currentName, targetName].forEach(name => {
    const note = form.querySelector(`[data-major-note-for="${name}"]`);
    const input = form.elements[name];
    if (!note || !input) return;
    const value = input.value.trim();
    const outside = value && isKnownOutsideCollege(catalog, form.elements[collegeName]?.value || "", value);
    note.textContent = outside ? t("savedOutsideCollege") : "";
    note.classList.toggle("hidden", !outside);
  });
}

function isKnownOutsideCollege(catalog, college, majorName) {
  if (!catalog || !college || !majorName) return false;
  const visible = new Set(majorsForCollege(catalog, college).map(major => major.full_name));
  const known = new Set((catalog.allMajors || []).map(major => major.full_name));
  return known.has(majorName) && !visible.has(majorName);
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
