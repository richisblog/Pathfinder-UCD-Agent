# Pathfinder Adaptive Consultation and Governance Design

Date: 2026-07-23
Status: Approved for written specification review
Project: Pathfinder UCD desktop application

## 1. Purpose

This design replaces Pathfinder's heuristic academic-consultation routing with a measurable clarification policy, introduces enforceable risk and human-approval lanes, restores dependable local document reading, and makes suggested questions responsive to the student's memory and recent conversation.

The design has five connected outcomes:

1. Ask the question that most improves the next decision instead of following a fixed clarification script.
2. Keep routine academic workflows inside documented SOPs while preventing the model from improvising in unfamiliar or sensitive cases.
3. Produce a useful human-handoff packet when Pathfinder must stop.
4. Reliably read PDF and common text documents in an installed application without requiring user-installed command-line or Python packages.
5. Generate personalized starting prompts and two or three one-click follow-up questions from live student context.

## 2. Current-State Findings

### 2.1 Document reading failure

The observed PDF failure is reproducible and has two independent causes.

First, the controller resolves an `@file` reference before the model call, but the Memory v5 path supplies the unexpanded raw user text as the compiler source. When Memory v5 emits its execution contract, the resolved `<file>...</file>` block is no longer present in the model-visible `source_event`. Existing tests currently encode that loss as expected behavior.

Second, PDF extraction falls back to host executables or Python libraries. On the affected machine, `pdftotext` is unavailable and the system Python has none of `pypdf`, `pdfplumber`, `fitz`, or `pdfminer`. The PDF is therefore stored successfully but cannot be converted to model-readable text.

### 2.2 Recommendation behavior

The empty-state welcome page renders four localized but static prompt strings. It does not consume student memory, recent sessions, current Known/Unknown state, academic timing, or active SOP state.

The composer has no post-answer suggestion strip. It can accept inserted prompts and send attached file references, so the new suggestions can reuse the existing send path rather than create a second messaging path.

### 2.3 Governance behavior

The application has general tool-approval infrastructure, but it does not have an academic-domain policy layer that:

- classifies consultation risk;
- binds a task to a versioned SOP;
- separates advice approval from tool approval;
- refuses unsupported cases;
- generates a structured handoff;
- records why a route or escalation was selected.

## 3. Design Principles

1. **Policy is code, not prose.** The model may propose classifications and questions, but a deterministic host policy decides which lane is permitted.
2. **Evidence precedes consequential advice.** Student-provided facts, successful tools, and current official sources are distinguishable from assumptions.
3. **Clarification has a cost.** Pathfinder asks only when the expected decision improvement exceeds the cost of interrupting the student.
4. **No silent escalation of autonomy.** Combining multiple SOPs increases approval requirements; it never grants additional authority.
5. **Refusal still helps.** An L3 response stops substantive decision-making but produces a complete, actionable human-handoff packet.
6. **Contacts are sourced records.** Email addresses, phone numbers, forms, and office locations carry official source URLs and verification dates.
7. **Local files remain local.** Extraction happens locally before bounded text is added to model context.
8. **Recommendations are ephemeral.** Suggested prompts do not become long-term memory unless the existing explicit memory workflow saves them.

## 4. System Architecture

The implementation adds six focused units.

### 4.1 Consultation SOP Registry

The registry owns versioned academic workflow definitions. Each SOP declares:

- stable identifier and version;
- localized title and description;
- supported intents and exclusions;
- default risk lane;
- required and optional slots;
- slot provenance requirements;
- decision-changing slots;
- official evidence requirements;
- allowed SOP combinations;
- approval checkpoints;
- completion conditions;
- escalation conditions;
- department-routing tags.

The registry is application data, not an LLM prompt. The model receives a bounded projection of only the active SOPs.

### 4.2 Consultation State

Each active conversation maintains:

- detected intent candidates;
- active SOP identifiers and versions;
- filled, missing, and conflicting slots;
- Known and Unknown consultation facts;
- evidence references;
- risk lane and reasons;
- pending approval checkpoint;
- clarification history;
- completed decisions;
- escalation and handoff state.

This state extends the existing consultation snapshot rather than creating an unrelated sidebar state. Historical snapshots remain backward compatible.

### 4.3 Clarification Optimizer

The optimizer generates candidate questions from missing decision-changing slots in the active SOP set. The model may paraphrase or combine candidates, but it cannot introduce an undeclared required slot without marking it as an exploratory candidate.

For candidate question \(q\), Pathfinder computes:

```text
score(q) =
  expected_uncertainty_reduction(q)
  + risk_weighted_error_reduction(q)
  + sop_completion_gain(q)
  + urgency_gain(q)
  - user_effort_cost(q)
  - repetition_penalty(q)
  - delay_cost(q)
```

The production approximation uses a bounded hypothesis set consisting of the valid next outcomes in the active SOPs. Probabilities come from normalized evidence-aware estimates and are never used as authorization. The optimizer records the score components for evaluation and audit.

Pathfinder asks when the highest candidate score is greater than the expected utility of proceeding with explicit assumptions. It asks at most one primary clarification at a time. Questions that can be answered from student memory or a successful authorized tool are not shown to the student.

### 4.4 Academic Risk Policy Engine

The policy engine receives the active SOPs, filled slots, evidence state, proposed next decision, tool or external action, and exception indicators. It returns:

```text
allow_information
require_student_confirmation
require_checkpoint_approval
handoff_only
```

The decision includes a lane, reason codes, required disclosures, missing confirmations, and permitted next actions. The model cannot override the returned lane.

### 4.5 Department Directory and Handoff Builder

The directory stores official contact records with:

- department identifier and routing tags;
- college and major applicability;
- contact purpose;
- public email, telephone, appointment URL, or official contact form;
- office location where published;
- official source URL;
- last verified date;
- optional effective or expiration date;
- locale-independent display name.

Major-level contacts are preferred when an official Catalog or department record matches. College advising is the fallback. Campus-wide services are selected for cross-college issues.

The handoff builder consumes consultation state and generates a structured, copyable packet. It does not send the packet automatically.

### 4.6 Document Ingestion and Suggestion Engine

Document ingestion provides one bounded extraction interface for pasted, dropped, selected, and workspace-referenced files. The suggestion engine consumes student memory, recent conversations, active consultation state, academic timing, and the SOP registry to produce start-page and follow-up suggestions.

## 5. Risk and Approval Lanes

### 5.1 L0 — Informational

Examples:

- course description;
- professor or course comparison;
- policy text;
- office contact information.

Behavior:

- answer from current sources;
- show source and verification date where applicable;
- disclose material uncertainty;
- no approval checkpoint unless an external action is proposed.

### 5.2 L1 — Single Standard SOP

Examples:

- routine course planning;
- prerequisite checks;
- ordinary add/drop guidance;
- workload comparison.

Behavior:

- collect all decision-changing required slots;
- show relevant evidence, assumptions, and predicted consequences;
- require the student to confirm the critical facts and proposed recommendation before treating the SOP as complete;
- do not submit official actions for the student.

### 5.3 L2 — Composite SOP

Examples:

- change of major plus prerequisite planning and graduation-time impact;
- dropping a class when full-time status, aid, and graduation timing may interact;
- transfer credit combined with degree certification.

Behavior:

- use only combinations declared compatible by the SOP registry;
- require approval at every branch that changes a consequential recommendation;
- display which SOPs are being combined;
- preserve separate evidence and completion conditions for each SOP;
- route to L3 if the combination contains an unsupported dependency or unresolved conflict.

### 5.4 L3 — Unsupported, Exceptional, or High-Sensitivity

Examples:

- illness or injury preventing return to campus;
- mental-health crisis;
- legal, immigration, disciplinary, or personal-safety issues;
- complex disability accommodations;
- facts that do not map to known SOPs;
- conflicting official rules that Pathfinder cannot resolve.

Behavior:

- refuse to make the substantive academic, medical, legal, or crisis decision;
- do not abandon the student;
- summarize the conversation and unresolved conditions;
- identify what an authorized human will likely need;
- match the appropriate official department;
- present current official contacts and sources;
- clearly distinguish emergency resources from ordinary appointments;
- never invent or infer private contact information.

## 6. Initial SOP Catalog

The first production catalog contains the following entries.

### 6.1 Course and Instructor Information

Supports course discovery, description comparison, professor evidence, prerequisites, restrictions, and availability. Instructor-rating evidence must be labeled separately from official course rules.

### 6.2 Schedule and Workload Planning

Collects term, enrolled/planned courses, time constraints, workload preferences, employment or activity constraints, and graduation relevance.

### 6.3 Prerequisite, Repeat, Waitlist, and Registration Restrictions

Distinguishes completed, in-progress, transferred, or unverified prerequisites. Official enrollment eligibility is never inferred solely from a student statement.

### 6.4 Add, Drop, Late Drop, PTD, and Grading Option

Collects term, course, deadline, current enrollment status, grading option, units, and downstream full-time or degree effects. Late actions and petitions always surface the relevant college advising route.

### 6.5 Major, Minor, Double Major, and Change of Major

Collects current college/major, target program, completed and planned prerequisites, GPA rules when officially published, unit count, expected graduation term, and target-major advising contact.

### 6.6 Degree Requirements and Graduation Assessment

Separates University, General Education, college, major, residence, unit, and unresolved transfer-credit requirements. Pathfinder provides a preliminary assessment, not official degree certification.

### 6.7 Transfer, AP/IB, External, and Simultaneous Enrollment Credit

Tracks source institution or exam, articulation evidence, posted credit, intended requirement, and college-specific approval needs.

### 6.8 Academic Standing, Withdrawal, and Readmission

Standard published procedures may be explained, but individual standing decisions, dismissal risk, and exception cases require college advising confirmation and may escalate to L3.

### 6.9 Excess Units, Repeats, Petitions, and Exceptions

Supports preparation and routing for published petition types. Pathfinder may draft a checklist but cannot predict petition approval.

### 6.10 Financial, Insurance, Housing, and Dining Navigation

Routes the student to the appropriate office and records how a nonacademic constraint affects an academic plan. Financial-aid or insurance eligibility determinations are not made by Pathfinder.

### 6.11 Research, Internship, and Career Planning

Supports preparation, opportunity comparison, qualification gaps, and advisor outreach drafts. It does not promise admission, funding, or placement.

### 6.12 Health, Counseling, Disability, and Emergency Academic Impact

This is a handoff-oriented SOP. It collects only the minimum information needed to route safely, avoids diagnosis, and directs the student to SHCS, the Student Disability Center, college advising, Aggie Compass, or emergency resources as appropriate.

## 7. Handoff Packet

The handoff packet contains:

1. Case title and current urgency.
2. Student's original goal in their own language.
3. Concise conversation summary.
4. A chronological Q&A ledger:
   - questions asked by the student;
   - clarification questions asked by Pathfinder;
   - the student's corresponding answers;
   - unanswered questions.
5. Confirmed facts with provenance.
6. Unknown, conflicting, or unverified facts.
7. Documents and official sources already reviewed.
8. Why Pathfinder escalated.
9. Questions the human advisor should consider next.
10. Information or documents the student may need to provide.
11. Related SOPs and possible cross-department dependencies.
12. Recommended departments, why each is relevant, contact methods, official source URLs, and verification dates.

The UI offers Copy and Save actions. Sending email, submitting a form, or creating an external ticket is outside this version and requires a future separately approved integration.

## 8. Department Matching

Department selection uses explicit routing tags and specificity:

```text
emergency or immediate safety
> specialist campus service
> major/program advising
> college advising
> campus-wide student support
```

Initial verified categories include:

- Student Health and Counseling Services;
- Student Disability Center;
- Aggie Compass;
- Student Housing and Dining Services;
- College of Letters and Science Undergraduate Education and Advising;
- Engineering Undergraduate Office;
- Biology Academic Success Center;
- CAES Undergraduate Academic Programs advising;
- major and department contacts derived from official Catalog or department pages.

Seed contacts supplied by the product owner are not shown until their official source is verified. Records whose verification age exceeds the configured freshness window are labeled as needing re-verification; Pathfinder prefers linking the official contact page over presenting an unverified address.

## 9. Document Ingestion

### 9.1 Supported Formats

The first release supports:

- `.txt`, `.md`, `.markdown`;
- `.csv`, `.tsv`;
- `.json`, `.yaml`, `.yml`;
- `.xml`, `.html`, `.htm`;
- `.rtf`;
- `.docx`;
- `.pdf`.

Unknown and binary formats are retained as attachments but are not represented as successfully read.

### 9.2 Extraction Boundary

The controller must carry two distinct values:

- `classification_input`: the student's unexpanded question used for intent and strategy classification;
- `source_event`: the complete model input containing bounded resolved document context.

Memory v5 may strip reference blocks only when computing its goal classifier. It must preserve the bounded reference content in the execution contract presented to the model.

### 9.3 Portable PDF Extraction

Pathfinder includes a pinned in-process PDF text extractor in the application build. Host `pdftotext` and Python libraries may remain optional diagnostic fallbacks, but successful basic extraction cannot depend on them.

The extractor returns:

- detected format;
- page count where available;
- bounded extracted text;
- character and byte counts;
- truncation status;
- extraction method;
- warnings for encrypted, malformed, or image-only documents.

Image-only PDFs return a specific `ocr_required` state. The agent is told not to retry generic file tools. OCR is not silently attempted in this release.

### 9.4 Common Text and DOCX Extraction

Plain text uses the existing encoding detection, UTF boundary handling, binary detection, and size caps. HTML and XML are converted to readable text while retaining headings and link targets where useful. DOCX extraction reads document XML locally and preserves paragraph and table-cell boundaries. RTF extraction supports readable text and reports unsupported embedded objects.

### 9.5 User Experience

The composer provides a visible Add document control in addition to drag, paste, and `@` reference behaviors. Each document chip shows:

- filename and format;
- extracting, ready, truncated, OCR required, or failed status;
- page or character count where available;
- a human-readable failure reason;
- remove action.

The Send action waits for active extraction. A failed extraction never appears as successfully processed.

### 9.6 Limits and Privacy

- extraction occurs locally;
- maximum accepted file size and maximum extracted characters are explicit configuration constants;
- only the bounded extracted text enters model context;
- raw files are not copied outside the existing attachment/workspace boundary;
- private user PDFs are not committed as test fixtures;
- tests use generated or redistributable fixtures.

## 10. Dynamic Start-Page Recommendations

The welcome page requests three or four recommendations generated from:

- student long-term profile;
- the latest relevant user and assistant turns from recent local sessions;
- current Known and Unknown consultation facts;
- active or recently incomplete SOPs;
- college, major, completed coursework, schedule, constraints, and preferences;
- upcoming academic dates available from the packaged calendar;
- recommendation exposure history.

Candidate prompts are produced from SOP templates and unresolved student context, then ranked by:

```text
relevance
+ urgency
+ expected usefulness
+ continuity with unfinished work
+ profile specificity
- repetition
- recently completed topic penalty
```

An optional model rewrite may make a candidate natural and concise, but the underlying intent and route remain tied to a known SOP. If memory or history is unavailable, localized generic prompts are used as a fallback. The current four static strings are no longer the primary source.

## 11. Post-Answer Follow-Up Suggestions

After a successful assistant answer, Pathfinder displays two or three one-click suggestions immediately above the composer.

Suggestions are derived from:

- the active SOP's highest-value next steps;
- remaining Unknown items;
- unresolved consequences mentioned in the answer;
- related compatible SOPs;
- the latest user intent and assistant response.

Rules:

- use the selected response language;
- do not repeat an already answered question;
- do not suggest an action prohibited by the current risk lane;
- prefer questions answerable by Pathfinder over vague prompts;
- expire when the user sends a new message, switches session, edits history, or enters handoff-only state;
- hide while an answer is streaming;
- click sends through the existing `handleSend` path;
- keyboard focus and accessible labels are required.

If semantic generation fails, Pathfinder falls back to deterministic SOP suggestions. If no relevant safe suggestion exists, the strip is omitted.

## 12. Data Flow

### 12.1 Normal Consultation Turn

1. The user submits text and optional documents.
2. Document ingestion extracts bounded local text and records extraction metadata.
3. Student memory, recent conversation, Known/Unknown state, and extracted evidence populate SOP slots.
4. Intent matching selects candidate SOPs.
5. The policy engine determines the current risk lane.
6. The clarification optimizer either selects one question or allows a supported next decision.
7. Consequential L1/L2 decisions render an approval checkpoint.
8. The assistant response and evidence update consultation state.
9. Safe follow-up suggestions are generated and shown above the composer.

### 12.2 Handoff Turn

1. The policy engine returns `handoff_only`.
2. Tool execution and substantive decision generation are restricted.
3. The handoff builder compiles the Q&A ledger, facts, gaps, evidence, and likely next questions.
4. The department matcher selects official contacts.
5. Pathfinder renders refusal scope, handoff packet, contacts, and source freshness.
6. No automatic external message is sent.

## 13. Error Handling

- Missing student memory degrades to conversation-only recommendations.
- Corrupt historical snapshots are ignored using existing validation patterns.
- Conflicting student answers create an Unknown conflict instead of overwriting Known.
- Failed official lookups cannot become Known evidence.
- Stale department contacts display the official contact page and a freshness warning.
- Failed document extraction keeps the attachment visible with a failed state.
- A malformed model-generated suggestion is rejected by schema validation.
- A policy-engine error fails closed to L3 for consequential tasks and to source-labeled informational output for L0 tasks.
- A suggestion-generation failure never blocks the main answer.

## 14. Evaluation and Telemetry

No raw document content, private contact data, or full student answers are added to telemetry.

Aggregate evaluation records:

- selected SOP and version;
- risk lane and reason codes;
- number of candidate clarification questions;
- selected score components;
- clarification count per resolved consultation;
- repeated-question rate;
- SOP completion and handoff rates;
- student approval, revision, and rejection counts;
- document extraction format, duration, result class, and truncation;
- suggestion impressions and clicks;
- stale or failed department-contact lookups.

Offline evaluation includes:

- replayed anonymized consultation scenarios;
- bilingual clarification quality;
- information gained per question;
- wrong-route and missed-escalation rate;
- over-escalation rate;
- approval bypass attempts;
- adversarial document instructions;
- stale-contact handling.

## 15. Testing Strategy

Implementation follows test-driven development.

### 15.1 Unit Tests

- SOP schema and version validation;
- slot provenance and conflict behavior;
- information-gain scoring and tie-breaking;
- risk-lane rules and fail-closed behavior;
- allowed and forbidden SOP combinations;
- department specificity and source freshness;
- handoff Q&A reconstruction;
- file-type detection and bounded extraction;
- PDF, DOCX, RTF, and encoding fixtures;
- dynamic recommendation ranking;
- follow-up expiry and risk filtering.

### 15.2 Integration Tests

- Memory v5 preserves resolved document context while classifying on raw user intent;
- pasted, dropped, selected, and workspace-referenced documents share the same extraction contract;
- consequential consultation produces an approval checkpoint;
- approved composite SOP resumes at the correct step;
- exceptional health scenario produces L3 handoff without substantive advice;
- conversation history restores active SOP, approvals, Known/Unknown, and handoff state;
- click-to-send suggestions use the normal send path.

### 15.3 Production-Build Tests

- packaged application extracts a text PDF with no `pdftotext` and no Python PDF packages on `PATH`;
- application reports `ocr_required` for an image-only PDF;
- supported text and DOCX files are readable from an installed application;
- frontend typecheck, full tests, production build, Wails build, and package validation pass.

## 16. Security and Governance Controls

- Policy decisions execute outside the model.
- Approval previews show the exact recommendation, material assumptions, evidence, and consequences.
- External instructions inside documents are treated as untrusted content.
- Document text cannot modify the SOP registry, risk policy, contacts, or approval state.
- Handoff packets minimize health and other sensitive information.
- Contact matching uses public official records only.
- All consequential policy decisions are auditable by reason code and SOP version.
- No email, form submission, registration change, course drop, or petition submission is performed in this release.

## 17. Non-Goals

This release does not:

- provide medical, legal, immigration, crisis, or disability determinations;
- replace official degree certification or advisor approval;
- perform OCR for scanned PDFs;
- automatically submit UC Davis forms;
- send emails or create external support tickets;
- train a reinforcement-learning clarification model;
- infer or scrape private staff contact information;
- automatically promote current-chat facts into long-term student memory.

## 18. Rollout

The work is divided into independently testable implementation plans:

1. Restore and harden local document ingestion.
2. Add SOP registry, consultation state, information-gain optimizer, and risk policy.
3. Add approval checkpoints, department directory, and handoff packet.
4. Add dynamic welcome recommendations and post-answer suggestions.
5. Run integrated governance, regression, production-build, and packaging verification.

Document ingestion is delivered first because current attachments demonstrably fail and every later workflow benefits from reliable student-provided evidence. The governance core follows before personalized recommendations so suggestions can be filtered through real SOP and risk policy rather than UI-only heuristics.
