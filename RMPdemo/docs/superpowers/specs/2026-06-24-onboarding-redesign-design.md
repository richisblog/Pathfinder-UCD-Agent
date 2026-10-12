# Pathfinder UCD Multilingual Onboarding Redesign

## Summary

Redesign the first-login experience from a single dense profile form into a guided, multilingual setup flow. The first step asks for language, then the wizard collects academic timeline, student stage, major direction, planning comfort, AP/IB/transfer credit, placement status, and a plain-language self assessment. The full profile remains editable later from Settings.

Figma design file: https://www.figma.com/design/IMYJHffPg9CvUOZrjOGXGL

Created Figma frames:

1. `01 Login / Sign in`
2. `02 First login welcome`
3. `03 Onboarding / Language`
4. `04 Onboarding / Student stage`
5. `05 Onboarding / Entry and graduation`
6. `06 Onboarding / School and major`
7. `07 Onboarding / Difficulty and workload`
8. `08 Onboarding / AP IB transfer`
9. `09 Onboarding / Placement`
10. `10 Onboarding / Self assessment`
11. `11 Onboarding / Review and start`
12. `12 Settings / Full profile editor`
13. `13 Implementation notes / i18n map`

## Goals

- Make first-time setup feel guided and low-pressure instead of exposing every profile field at once.
- Support English and Chinese copy through a lightweight i18n system.
- Save stable student context so chat answers can use less repeated setup.
- Default planning difficulty based on student stage while allowing user override.
- Capture AP, IB, transfer credit, placement, and self-assessment context in a student-friendly way.
- Redesign Login, first-time setup, and Settings as a cohesive product surface.

## Non-Goals

- Do not make onboarding a substitute for official UC Davis records.
- Do not infer official AP/placement outcomes from the profile alone. Treat profile data as user-provided context.
- Do not require highly structured AP/IB/placement entry before the user can start chatting.
- Do not redesign the chat experience in this scope.

## Information Architecture

### Login

Route: `/login`

Purpose:
- Present Pathfinder UCD as a student planning assistant.
- Start Google OAuth with a clear `@ucdavis.edu` requirement.
- Mention English/Chinese support without forcing language choice before authentication.

Primary content:
- Brand: Pathfinder UCD.
- Headline: sign in with UC Davis email.
- CTA: Continue with Google.
- Fine print: only `@ucdavis.edu`; private data and API keys stay server-side.

### First-Time Welcome

Route: `/onboarding`

Purpose:
- Explain why setup exists.
- Reassure users that setup is editable later.
- Let users start the wizard.

Primary content:
- Course suggestions use year, major, credits, and comfort level.
- AP/IB/transfer and placement notes are user-provided context.
- Plain-language concerns help Pathfinder explain tradeoffs.

### Step 1: Language

Required: yes.

Fields:
- `language`: `en` or `zh`.

Behavior:
- Choosing a language immediately changes the wizard copy.
- Store language in saved profile data and mirror it in `localStorage` so pre-auth/login UI can remember the user's preference later.
- Initial login page can default to browser language or `localStorage`.

### Step 2: Student Stage

Required: yes.

Fields:
- `student_type`: `freshman`, `transfer`, `continuing`, or `prospective`.

Default difficulty:
- `freshman`: `Light`
- `transfer`: `Light`
- `prospective`: `Light`
- `continuing`: `Moderate`

Behavior:
- Apply the default only when the user has not already chosen a difficulty.
- Show a small explanation that the default can be changed in the next step.

### Step 3: Entry and Graduation

Required: recommended but not blocking except profile completeness rules.

Fields:
- `entry_term`
- `entry_year`
- `graduation_year`

Behavior:
- Accept approximate years.
- Show a simple preview such as `Fall 2026 -> Spring 2030`.
- For transfer students, UI copy should acknowledge that a shorter expected timeline is normal.

### Step 4: College and Major Direction

Required:
- At least one of `current_major` or `target_major`, matching the current backend completeness rule.

Fields:
- `college`
- `current_major`
- `target_major`
- `considering_change_major`

Behavior:
- Let new or prospective students enter `Undeclared / Not sure yet`.
- Use supportive copy instead of forcing certainty.

### Step 5: Difficulty and Workload

Required: no, but should have a default.

Fields:
- `course_preferences.max_difficulty`
- `course_preferences.target_units`
- `course_preferences.priority`

Options:
- Difficulty: `Light`, `Moderate`, `Challenging is okay`.
- Planning priority: `Balanced`, `GPA first`, `Learn deeply`, `Graduate early`, `Explore majors`.

Behavior:
- Prefill difficulty from student stage.
- Allow explicit override.
- Target units can be a number or short range such as `14-15`.

### Step 6: AP / IB / Transfer Credit

Required: no.

Fields:
- `ap_ib_summary`

Behavior:
- Use a plain textarea.
- Examples should mention AP, IB HL, and community college transfer coursework.
- The profile context must state that this is user-provided and should be checked against official sources.

### Step 7: Placement

Required: no.

Fields:
- `placement_summary`

UI:
- Checklist-style options for common areas:
  - Math placement done
  - Chemistry placement pending
  - Writing / ELWR not sure
  - Language placement not relevant
- Free-text notes.

Behavior:
- The frontend can combine checklist labels and notes into `placement_summary`.
- Chat should continue to use source-backed retrieval for official placement rules.

### Step 8: Self Assessment

Required: no.

Fields:
- Preferred: `course_preferences.self_assessment`
- Alternative if later migration is desired: dedicated `student_profiles.self_assessment` column.

Prompt:
- Ask in plain language: "What kind of student are you? Tell us about your learning style, confidence, worries, schedule constraints, or courses you want to avoid."

Behavior:
- Encourage casual language.
- Avoid judging the answer.
- Use this context to make explanations more empathetic, not to lower factual rigor.

### Review and Start

Required: yes before saving.

Purpose:
- Summarize saved profile context.
- Let user go back to edit any step.
- Save with `/api/profile`.
- Redirect to `/chat` once `profile_complete` is true.

## Settings Redesign

Route: `/settings`

Settings should not reuse the wizard. It should be a full editor with clear sections:

- Language
- Academic profile
- Planning preferences
- AP / IB / transfer credit
- Placement
- Self assessment
- API and quota

The API/provider settings remain separate from student profile context. Personal API key controls should not visually feel like part of academic profile setup.

## i18n Design

Add a lightweight frontend dictionary, for example:

```js
export const messages = {
  en: {
    onboardingLanguageTitle: "Choose your language",
    onboardingStudentStageTitle: "What kind of student are you?",
  },
  zh: {
    onboardingLanguageTitle: "选择你的语言",
    onboardingStudentStageTitle: "你现在是哪一类学生？",
  },
};
```

Recommended files:

- `web/static/js/i18n.js`: dictionary, language state, translation helper.
- `web/static/js/onboarding.js`: step controller renders copy by translation key.
- `web/static/js/settings.js`: uses the same dictionary for labels and help text.
- `web/static/js/login.js`: reads `localStorage` language if available.

Rules:

- No user-visible onboarding strings should be hardcoded directly in step-rendering logic.
- Keep option values stable in English-like backend values, and translate only display labels.
- Unknown language falls back to `en`.
- `zh` copy should be natural Chinese, not literal machine translation.

## Data Model

Existing fields to keep:

- `student_type`
- `current_major`
- `target_major`
- `college`
- `entry_term`
- `entry_year`
- `graduation_year`
- `considering_change_major`
- `ap_ib_summary`
- `placement_summary`
- `course_preferences.priority`
- `course_preferences.max_difficulty`
- `course_preferences.target_units`
- `course_preferences.professor_style`
- `course_preferences.schedule_preference`

Fields to add:

- `language`: either a new `student_profiles.language` column or `course_preferences.language`.
- `course_preferences.self_assessment`

Recommended backend approach:

- Add `language` as a top-level profile column because it is an account-level UI preference, not a course preference.
- Store `self_assessment` in `course_preferences_json` to avoid a schema migration for a flexible narrative field.

Profile completeness:

- Keep current minimum: `student_type` plus at least one of `current_major` or `target_major`.
- Language should be required in the wizard, but not necessary to make older profiles complete. Older profiles default to English.

## Validation and Error Handling

- Validate one step at a time.
- Show inline step errors, not one global form error after the final submit.
- Allow optional steps to be skipped.
- Preserve draft answers in memory while moving between steps.
- If save fails, keep the user on Review and show the server error.
- If session expires, redirect to `/login`.

## Visual Direction

- Quiet academic planning product, not a marketing landing page.
- Mobile-first wizard frame around 390px wide.
- Settings uses a wider two-column editor.
- Palette:
  - Background: soft green-gray.
  - Primary: UC Davis-adjacent green for action and selected states.
  - Secondary accents: muted blue for implementation/info notes, warm tan for examples.
- Cards have small-to-medium radii and clear borders.
- Avoid dense all-at-once forms in onboarding.
- Use progress indicators on wizard steps.

## Implementation Plan Outline

1. Add i18n helper and dictionaries.
2. Expand profile sanitization to accept `language` and `self_assessment`.
3. Replace onboarding template with a wizard shell.
4. Rewrite `onboarding.js` as a step controller.
5. Keep `profile-form.js` for Settings or split shared data serialization helpers.
6. Redesign `profile.css` and `auth.css` to match the Figma direction.
7. Update tests for new profile fields, wizard assets, and backward compatibility.

## Verification Notes

- Figma file was created successfully and populated with 13 frames.
- Representative screenshots for Login, Language, and Difficulty were generated successfully through the Figma MCP tool.
- Settings screenshot could not be generated because the connected Figma Starter plan reached the MCP tool-call limit.
- Additional visual QA should be done manually in Figma or after MCP limit resets/upgrades.
