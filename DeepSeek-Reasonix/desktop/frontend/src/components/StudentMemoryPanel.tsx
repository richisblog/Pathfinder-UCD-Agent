import { Check, FileText, GraduationCap, Pencil, Save, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useT } from "../lib/i18n";
import { STUDENT_MEMORY_FIELDS, parseStudentMemory, writeStudentMemory, type StudentMemoryFieldId, type StudentMemoryProfile } from "../lib/studentMemory";
import type { MemoryView } from "../lib/types";

const FIELD_ICONS: Record<StudentMemoryFieldId, typeof UserRound> = {
  transcript: GraduationCap,
  resume: FileText,
  timetable: UserRound,
  courseSchedule: GraduationCap,
  academicStyle: Pencil,
  major: GraduationCap,
  college: GraduationCap,
  preferences: UserRound,
};

const FIELD_LABEL_KEYS = {
  transcript: "studentMemory.transcript",
  resume: "studentMemory.resume",
  timetable: "studentMemory.timetable",
  courseSchedule: "studentMemory.courseSchedule",
  academicStyle: "studentMemory.academicStyle",
  major: "studentMemory.major",
  college: "studentMemory.college",
  preferences: "studentMemory.preferences",
} as const;

export function StudentMemoryPanel({
  view,
  onSaveDoc,
}: {
  view: MemoryView;
  onSaveDoc: (path: string, body: string) => Promise<void>;
}) {
  const t = useT();
  const userDoc = useMemo(() => view.docs.find((doc) => doc.scope === "user"), [view.docs]);
  const userPath = userDoc?.path || view.scopes.find((scope) => scope.scope === "user")?.path || "";
  const userBody = userDoc?.body || "";
  const parsed = useMemo(() => parseStudentMemory(userBody), [userBody]);
  const [profile, setProfile] = useState<StudentMemoryProfile>(parsed);
  const [editing, setEditing] = useState<StudentMemoryFieldId | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<StudentMemoryFieldId | null>(null);

  useEffect(() => setProfile(parsed), [parsed]);

  const beginEdit = (id: StudentMemoryFieldId) => {
    setEditing(id);
    setDraft(profile[id]);
    setError("");
  };

  const save = async (id: StudentMemoryFieldId) => {
    if (!userPath || busy) return;
    const next = { ...profile, [id]: draft.trim() };
    setBusy(true);
    setError("");
    try {
      await onSaveDoc(userPath, writeStudentMemory(userBody, next));
      setProfile(next);
      setEditing(null);
      setSaved(id);
      window.setTimeout(() => setSaved((current) => current === id ? null : current), 1400);
    } catch (value) {
      setError(String(value));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="student-memory" aria-labelledby="student-memory-title">
      <div className="student-memory__header">
        <div>
          <h3 id="student-memory-title">{t("studentMemory.title")}</h3>
          <p>{t("studentMemory.description")}</p>
        </div>
        <span className="student-memory__privacy">{t("studentMemory.agentHint")}</span>
      </div>
      {!userPath && <div className="mem-error" role="alert">{t("studentMemory.noUserDocument")}</div>}
      {error && <div className="mem-error" role="alert">{error}</div>}
      <div className="student-memory__grid">
        {STUDENT_MEMORY_FIELDS.map((field) => {
          const Icon = FIELD_ICONS[field.id];
          const isEditing = editing === field.id;
          const value = profile[field.id];
          return (
            <article className={`student-memory-card${isEditing ? " student-memory-card--editing" : ""}`} key={field.id}>
              <div className="student-memory-card__head">
                <span className="student-memory-card__icon"><Icon size={16} /></span>
                <h4>{t(FIELD_LABEL_KEYS[field.id])}</h4>
                {!isEditing && (
                  <button type="button" onClick={() => beginEdit(field.id)} disabled={!userPath || busy} aria-label={t("common.edit")}>
                    {saved === field.id ? <Check size={14} /> : <Pencil size={14} />}
                  </button>
                )}
              </div>
              {isEditing ? (
                <div className="student-memory-card__editor">
                  <textarea autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t("studentMemory.fieldPlaceholder")} />
                  <div className="student-memory-card__actions">
                    <button type="button" onClick={() => setEditing(null)} disabled={busy}>{t("common.cancel")}</button>
                    <button type="button" className="student-memory-card__save" onClick={() => void save(field.id)} disabled={busy}>
                      <Save size={13} /> {t("common.save")}
                    </button>
                  </div>
                </div>
              ) : (
                <p className={value ? "" : "student-memory-card__empty"}>{value || t("studentMemory.emptyField")}</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
