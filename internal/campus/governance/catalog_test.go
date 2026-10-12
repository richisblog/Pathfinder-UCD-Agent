package governance

import (
	"strings"
	"testing"
)

func TestDefaultRegistryContainsApprovedCatalog(t *testing.T) {
	t.Parallel()

	registry := DefaultRegistry()
	if err := registry.Validate(); err != nil {
		t.Fatalf("DefaultRegistry().Validate() error = %v", err)
	}

	wantIDs := map[string]bool{
		"course_information":              false,
		"schedule_workload":               false,
		"prerequisite_registration":       false,
		"add_drop_grading":                false,
		"major_change":                    false,
		"degree_graduation":               false,
		"transfer_credit":                 false,
		"standing_withdrawal_readmission": false,
		"petitions_exceptions":            false,
		"financial_housing_navigation":    false,
		"research_career":                 false,
		"health_disability_emergency":     false,
	}
	if len(registry.SOPs) != len(wantIDs) {
		t.Fatalf("DefaultRegistry() contains %d SOPs, want %d", len(registry.SOPs), len(wantIDs))
	}

	for id := range wantIDs {
		sop, ok := registry.Get(id)
		if !ok {
			t.Errorf("DefaultRegistry().Get(%q) returned no SOP", id)
			continue
		}
		if sop.ID != id {
			t.Errorf("DefaultRegistry().Get(%q).ID = %q", id, sop.ID)
		}
		wantIDs[id] = true
	}
	for id, found := range wantIDs {
		if !found {
			t.Errorf("approved SOP %q is missing", id)
		}
	}
}

func TestDefaultRegistryReturnsDeterministicCopies(t *testing.T) {
	t.Parallel()

	first := DefaultRegistry()
	second := DefaultRegistry()
	if len(first.SOPs) == 0 || len(first.SOPs[0].Intents) == 0 || len(first.SOPs[0].Slots) == 0 {
		t.Fatal("DefaultRegistry() returned an incomplete catalog fixture")
	}

	first.SOPs[0].Intents[0] = "mutated"
	first.SOPs[0].Slots[0].ID = "mutated"
	if got := second.SOPs[0].Intents[0]; got == "mutated" {
		t.Error("independent DefaultRegistry calls share intent storage")
	}
	if got := second.SOPs[0].Slots[0].ID; got == "mutated" {
		t.Error("independent DefaultRegistry calls share slot storage")
	}

	returned, ok := second.Get("course_information")
	if !ok {
		t.Fatal("Get(course_information) returned no SOP")
	}
	returned.Intents[0] = "mutated"
	returned.Slots[0].ID = "mutated"
	again, ok := second.Get("course_information")
	if !ok {
		t.Fatal("Get(course_information) returned no SOP on second lookup")
	}
	if again.Intents[0] == "mutated" || again.Slots[0].ID == "mutated" {
		t.Error("Get returned shared SOP storage")
	}
}

func TestRegistryValidateRejectsInvalidDefinitions(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		edit func(*Registry)
		want string
	}{
		{
			name: "blank SOP ID",
			edit: func(r *Registry) { r.SOPs[0].ID = "  " },
			want: "id",
		},
		{
			name: "duplicate SOP ID",
			edit: func(r *Registry) { r.SOPs = append(r.SOPs, r.SOPs[0]) },
			want: "duplicate",
		},
		{
			name: "invalid semantic version",
			edit: func(r *Registry) { r.SOPs[0].Version = "one" },
			want: "version",
		},
		{
			name: "invalid lane",
			edit: func(r *Registry) { r.SOPs[0].Lane = Lane("L9") },
			want: "lane",
		},
		{
			name: "missing English title",
			edit: func(r *Registry) { r.SOPs[0].TitleEN = "" },
			want: "title",
		},
		{
			name: "missing Chinese title",
			edit: func(r *Registry) { r.SOPs[0].TitleZH = "" },
			want: "title",
		},
		{
			name: "duplicate slot ID",
			edit: func(r *Registry) { r.SOPs[0].Slots = append(r.SOPs[0].Slots, r.SOPs[0].Slots[0]) },
			want: "duplicate slot",
		},
		{
			name: "required decision-changing slot without prompts",
			edit: func(r *Registry) {
				r.SOPs[0].Slots[0].Required = true
				r.SOPs[0].Slots[0].DecisionChanging = true
				r.SOPs[0].Slots[0].PromptEN = ""
				r.SOPs[0].Slots[0].PromptZH = ""
			},
			want: "prompt",
		},
		{
			name: "unknown combination reference",
			edit: func(r *Registry) { r.SOPs[0].AllowedCombinations = []string{"missing_sop"} },
			want: "unknown",
		},
		{
			name: "self combination reference",
			edit: func(r *Registry) { r.SOPs[0].AllowedCombinations = []string{r.SOPs[0].ID} },
			want: "itself",
		},
		{
			name: "L3 SOP without department tags",
			edit: func(r *Registry) {
				r.SOPs[0].Lane = LaneL3
				r.SOPs[0].DepartmentTags = nil
			},
			want: "department",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			registry := validRegistry()
			tt.edit(&registry)
			err := registry.Validate()
			if err == nil {
				t.Fatal("Validate() error = nil, want rejection")
			}
			if !strings.Contains(strings.ToLower(err.Error()), tt.want) {
				t.Errorf("Validate() error = %q, want it to contain %q", err, tt.want)
			}
		})
	}
}

func TestRegistryGetReturnsMissingForUnknownID(t *testing.T) {
	t.Parallel()

	if _, ok := DefaultRegistry().Get("not_a_sop"); ok {
		t.Error("Get(not_a_sop) reported a match")
	}
}

func validRegistry() Registry {
	return Registry{SOPs: []SOP{{
		ID:      "course_information",
		Version: "1.0.0",
		TitleEN: "Course information",
		TitleZH: "课程信息",
		Lane:    LaneL0,
		Slots: []Slot{{
			ID:       "course",
			PromptEN: "Which course?",
			PromptZH: "哪门课程？",
		}},
	}}}
}
