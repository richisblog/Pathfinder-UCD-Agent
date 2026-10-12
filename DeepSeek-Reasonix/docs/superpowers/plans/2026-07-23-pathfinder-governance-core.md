# Pathfinder Quantified Clarification and Risk Governance Implementation Plan

Date: 2026-07-23
Status: Ready for execution
Depends on: `docs/superpowers/specs/2026-07-23-pathfinder-adaptive-consultation-governance-design.md`

## Goal

Replace Pathfinder's academic-consultation keyword routing with a deterministic,
auditable SOP registry, a quantitative clarification selector, and a fail-closed
risk policy. The model may phrase a question, but the host selects the permitted
lane, the active SOPs, and the highest-value missing slot.

## Task 1: Define and Validate the Versioned SOP Registry

**Files**

- Create: `internal/campus/governance/types.go`
- Create: `internal/campus/governance/catalog.go`
- Create: `internal/campus/governance/catalog_test.go`

**Required interfaces**

```go
type Lane string

const (
    LaneL0 Lane = "L0"
    LaneL1 Lane = "L1"
    LaneL2 Lane = "L2"
    LaneL3 Lane = "L3"
)

type Slot struct {
    ID               string
    Required         bool
    DecisionChanging bool
    StudentOwned     bool
    PromptEN         string
    PromptZH         string
}

type SOP struct {
    ID                   string
    Version              string
    TitleEN              string
    TitleZH              string
    Lane                 Lane
    Intents              []string
    Exclusions           []string
    Slots                []Slot
    AllowedCombinations  []string
    ApprovalCheckpoints  []string
    EscalationIndicators []string
    DepartmentTags       []string
}

func DefaultRegistry() Registry
func (r Registry) Validate() error
func (r Registry) Get(id string) (SOP, bool)
```

The default registry must contain all 12 approved SOP categories:

1. `course_information`
2. `schedule_workload`
3. `prerequisite_registration`
4. `add_drop_grading`
5. `major_change`
6. `degree_graduation`
7. `transfer_credit`
8. `standing_withdrawal_readmission`
9. `petitions_exceptions`
10. `financial_housing_navigation`
11. `research_career`
12. `health_disability_emergency`

Validation rejects duplicate/blank IDs, invalid semantic versions, invalid
lanes, missing localized titles, duplicate slots, required decision-changing
slots without a prompt, unknown/self combination references, and L3 SOPs
without department tags.

**TDD**

1. Write tests for catalog completeness and all validation failures.
2. Observe RED.
3. Implement the minimum schema/catalog.
4. Run:

```bash
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/campus/governance -run 'Test(DefaultRegistry|RegistryValidate)' -count=1
```

**Commit**

```text
feat: define academic consultation SOP registry
```

---

## Task 2: Add Deterministic Intent Matching and Composite-SOP Resolution

**Files**

- Create: `internal/campus/governance/matcher.go`
- Create: `internal/campus/governance/matcher_test.go`

**Required interfaces**

```go
type Match struct {
    SOPID      string
    Confidence float64
    Reasons    []string
}

type MatchResult struct {
    Matches             []Match
    ActiveSOPs          []string
    UnsupportedConflict bool
    ReasonCodes         []string
}

func (r Registry) Match(text string) MatchResult
```

Normalize Chinese and English text, score explicit intent phrases instead of a
single boolean keyword hit, sort deterministically, and retain only credible
matches. Resolve multiple matches only when every pair declares the combination
compatible. A multi-SOP result is composite and must not lower the maximum
component risk.

Tests must cover:

- ordinary course information → `course_information`;
- add/drop → `add_drop_grading`;
- change major + graduation timing → compatible L2 composite;
- drop + financial-aid/full-time interaction → compatible L2 composite;
- illness/cannot return, crisis, disability, legal/immigration/disciplinary
  novelty → handoff-oriented or unsupported conflict;
- completely novel consequential scenario → no guessed SOP and reason
  `no_supported_sop`;
- deterministic tie-breaking.

**TDD command**

```bash
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/campus/governance -run 'TestMatch' -count=1
```

**Commit**

```text
feat: match academic requests to compatible SOPs
```

---

## Task 3: Implement Quantitative Information-Gain Question Selection

**Files**

- Create: `internal/campus/governance/optimizer.go`
- Create: `internal/campus/governance/optimizer_test.go`

**Required interfaces**

```go
type CandidateQuestion struct {
    SOPID                     string
    SlotID                    string
    Text                      string
    OutcomeProbabilities      []float64
    ExpectedPosteriorEntropy  float64
    RiskErrorReduction        float64
    SOPCompletionGain         float64
    UrgencyGain               float64
    UserEffortCost            float64
    RepetitionPenalty         float64
    DelayCost                 float64
}

type ScoreBreakdown struct {
    PriorEntropy          float64
    ExpectedEntropy       float64
    UncertaintyReduction  float64
    RiskErrorReduction    float64
    SOPCompletionGain     float64
    UrgencyGain           float64
    UserEffortCost        float64
    RepetitionPenalty     float64
    DelayCost             float64
    Total                 float64
}

type SelectedQuestion struct {
    Candidate CandidateQuestion
    Score     ScoreBreakdown
    Ask       bool
    Reason    string
}

func ScoreQuestion(prior []float64, candidate CandidateQuestion) (ScoreBreakdown, error)
func SelectQuestion(prior []float64, candidates []CandidateQuestion, proceedUtility float64) (SelectedQuestion, error)
```

Use Shannon entropy in bits. Validate and normalize finite non-negative
probabilities. Compute:

```text
uncertainty_reduction =
  entropy(prior) - expected_posterior_entropy

total =
  uncertainty_reduction
  + risk_error_reduction
  + sop_completion_gain
  + urgency_gain
  - user_effort_cost
  - repetition_penalty
  - delay_cost
```

Select one highest-scoring question only when `total > proceedUtility`.
Tie-break by higher risk reduction, then decision-changing slot order, SOP ID,
and slot ID. Reject NaN/Inf, negative costs, mismatched empty hypotheses, and
posterior entropy above prior unless explicitly clamped within floating error.

Tests must demonstrate that:

- a high-entropy decision-changing slot beats a low-value profile question;
- a safety-critical question can win through risk reduction;
- repetition and user effort can make proceeding preferable;
- ties are deterministic;
- invalid distributions fail closed.

**TDD command**

```bash
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/campus/governance -run 'Test(ScoreQuestion|SelectQuestion)' -count=1
```

**Commit**

```text
feat: optimize clarification questions by information gain
```

---

## Task 4: Implement the Fail-Closed Academic Risk Policy

**Files**

- Create: `internal/campus/governance/policy.go`
- Create: `internal/campus/governance/policy_test.go`

**Required interfaces**

```go
type Action string

const (
    AllowInformation          Action = "allow_information"
    RequireStudentConfirmation Action = "require_student_confirmation"
    RequireCheckpointApproval Action = "require_checkpoint_approval"
    HandoffOnly               Action = "handoff_only"
)

type PolicyInput struct {
    Match                 MatchResult
    FilledSlots           map[string]SlotValue
    MissingSlots          []string
    ConsequentialDecision bool
    ExternalAction        bool
    ExceptionIndicators   []string
    EngineError           error
}

type PolicyDecision struct {
    Lane                 Lane
    Action               Action
    ActiveSOPs           []string
    ReasonCodes          []string
    RequiredDisclosures  []string
    MissingConfirmations []string
    PermittedNextActions []string
}

func (r Registry) Decide(input PolicyInput) PolicyDecision
```

Rules:

- L0 information is allowed with source/uncertainty disclosure.
- L1 needs all decision-changing required slots and student confirmation before
  a consequential recommendation is marked complete.
- A compatible multi-SOP request is at least L2 and requires checkpoint
  approval at every recommendation-changing branch.
- Unknown combinations, no supported SOP for a consequential request,
  exception indicators, health/crisis/disability/legal/immigration/safety
  sensitivity, or an engine error return L3 `handoff_only`.
- External enrollment, drop, petition, email, or form actions are never
  permitted in this release.
- L3 permits only clarification needed for safe routing, handoff generation,
  official contact lookup, copy, and local save.

Tests include the user's canonical case: “学生突然生病了，不能再来学校”
must be L3/handoff-only and must not permit substantive academic decisions.

**TDD command**

```bash
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/campus/governance -run 'TestPolicy' -count=1
```

**Commit**

```text
feat: enforce academic risk and approval lanes
```

---

## Task 5: Build Consultation Assessments and Highest-Value Slot Questions

**Files**

- Create: `internal/campus/governance/assess.go`
- Create: `internal/campus/governance/assess_test.go`

**Required interfaces**

```go
type SlotValue struct {
    Value      string
    Provenance string
    Confirmed  bool
}

type AssessmentInput struct {
    Text              string
    Known             []string
    Unknown           []string
    AskedSlotIDs      []string
    Language          string
    Consequential     bool
    ProceedUtility    float64
}

type Assessment struct {
    Match             MatchResult
    Decision          PolicyDecision
    SelectedQuestion  *SelectedQuestion
    MissingSlots      []string
    Audit             []string
}

func (r Registry) Assess(input AssessmentInput) Assessment
```

The assessor deterministically projects Known/Unknown strings into explicit
slot IDs only when they contain `slot_id=value`; free prose remains unverified.
It builds candidates only from missing decision-changing slots, penalizes
already-asked slots, runs `SelectQuestion`, and never asks an ordinary SOP
question after `handoff_only` except a minimal routing question declared by the
L3 SOP.

Tests cover:

- known slots are not asked again;
- only one question is selected;
- information-gain score components are recorded;
- L3 suppresses ordinary advising questions;
- missing language falls back to English without changing routing.

**TDD command**

```bash
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/campus/governance -run 'TestAssess' -count=1
```

**Commit**

```text
feat: assess consultation gaps with auditable scoring
```

---

## Task 6: Replace Heuristic Progress Routing with Governance Context

**Files**

- Modify: `internal/campus/progress/policy.go`
- Modify: `internal/campus/progress/context.go`
- Modify: `internal/campus/progress/progress_test.go`
- Create: `internal/campus/progress/governance_test.go`
- Modify: `internal/campus/native/tools.go`
- Modify: `internal/campus/native/tools_test.go`

**Interfaces**

- Preserve `ManagedConsultation(input, todos) bool`.
- Extend `BuildContext` output with a bounded
  `<consultation-governance>` block containing:
  active SOP/version, lane, action, reason codes, missing slots, selected
  clarification text and score components, permitted next actions, and explicit
  L3 refusal/handoff constraints.

Implementation:

1. Replace `managedMarkers` routing with `governance.DefaultRegistry().Match`.
   Existing todos still keep a follow-up managed.
2. For a managed turn call `Assess` and append the governance block beside the
   existing progress snapshot.
3. Update `SystemPromptAddon` so the model:
   - may paraphrase only the selected clarification without changing its slot;
   - asks at most one primary question;
   - cannot lower a host lane;
   - treats L1/L2 completion as confirmation/checkpoint-gated;
   - on L3 refuses substantive decisions and produces/requests a handoff.
4. Keep the context bounded and free of hidden reasoning; expose only score
   components and reason codes.

Tests must prove:

- course info remains unmanaged or L0 without forced todo overhead;
- change-major planning gets L1/L2 governance context;
- “生病不能返校” gets L3/handoff-only context;
- “继续” with existing todos remains managed;
- one selected question and numeric score are rendered;
- context stays within its rune bound.

Because `internal/campus/native/tools.go` is user-dirty in the current worktree,
patch it incrementally and do not stage or commit pre-existing changes. Commit
the clean governance/progress files separately if possible; otherwise leave
the integration hunk unstaged and document it.

**Verification**

```bash
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/campus/governance ./internal/campus/progress ./internal/campus/native -count=1
```

**Commit**

```text
feat: route consultations through academic governance
```

---

## Task 7: Governance Regression and Scenario Matrix

**Files**

- Create: `internal/campus/governance/scenario_test.go`
- Modify only if a demonstrated governance regression requires it.

Table-driven scenarios must cover in Chinese and English:

- course/instructor information (L0);
- standard course selection and workload (L1);
- standard add/drop (L1);
- major change + graduation impact (L2);
- drop + full-time/financial interaction (L2);
- graduation preliminary assessment (L1);
- novel consequential case with no SOP (L3);
- illness preventing return (L3);
- mental-health crisis (L3);
- legal/immigration/disciplinary/safety issue (L3);
- policy engine error (L3);
- prompt-injection text inside a document cannot lower the host lane.

Assert lane, action, active SOPs, permitted actions, and whether a clarification
may be asked. Run:

```bash
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/campus/governance ./internal/campus/progress ./internal/campus/native -count=1
/Users/richis/Documents/RMP咨询APP/.toolchains/go/bin/go test ./internal/campus/governance -run TestGovernanceScenarioMatrix -count=1
```

No separate review agent is required; this task is the unified governance gate.

---

## Out of Scope for This Plan

- department directory and sourced contacts;
- Q&A handoff packet and Copy/Save UI;
- welcome-page and post-answer suggestions;
- email/form submission;
- medical/legal/immigration determinations;
- OCR.

Those are delivered by the next independent plans after the host governance
decision is available.
