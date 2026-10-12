package governance

import (
	"fmt"
	"regexp"
	"strings"
)

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

// Registry is the ordered, versioned set of consultation SOP definitions.
// SOPs preserves catalog order so callers receive deterministic results.
type Registry struct {
	SOPs []SOP
}

var semanticVersion = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`)

// Validate verifies that the registry can be safely used as application data.
func (r Registry) Validate() error {
	ids := make(map[string]struct{}, len(r.SOPs))
	for _, sop := range r.SOPs {
		if strings.TrimSpace(sop.ID) == "" {
			return fmt.Errorf("SOP ID must not be blank")
		}
		if _, exists := ids[sop.ID]; exists {
			return fmt.Errorf("duplicate SOP ID %q", sop.ID)
		}
		ids[sop.ID] = struct{}{}
		if !semanticVersion.MatchString(sop.Version) {
			return fmt.Errorf("SOP %q has invalid semantic version %q", sop.ID, sop.Version)
		}
		if !validLane(sop.Lane) {
			return fmt.Errorf("SOP %q has invalid lane %q", sop.ID, sop.Lane)
		}
		if strings.TrimSpace(sop.TitleEN) == "" || strings.TrimSpace(sop.TitleZH) == "" {
			return fmt.Errorf("SOP %q must provide localized titles", sop.ID)
		}
		if err := validateSlots(sop); err != nil {
			return err
		}
		if sop.Lane == LaneL3 && !hasNonBlank(sop.DepartmentTags) {
			return fmt.Errorf("L3 SOP %q must provide department tags", sop.ID)
		}
	}

	for _, sop := range r.SOPs {
		for _, combinationID := range sop.AllowedCombinations {
			if combinationID == sop.ID {
				return fmt.Errorf("SOP %q cannot combine with itself", sop.ID)
			}
			if _, exists := ids[combinationID]; !exists {
				return fmt.Errorf("SOP %q references unknown combination %q", sop.ID, combinationID)
			}
		}
	}
	return nil
}

// Get returns an independent copy of the SOP identified by id.
func (r Registry) Get(id string) (SOP, bool) {
	for _, sop := range r.SOPs {
		if sop.ID == id {
			return cloneSOP(sop), true
		}
	}
	return SOP{}, false
}

func validLane(lane Lane) bool {
	switch lane {
	case LaneL0, LaneL1, LaneL2, LaneL3:
		return true
	default:
		return false
	}
}

func validateSlots(sop SOP) error {
	slotIDs := make(map[string]struct{}, len(sop.Slots))
	for _, slot := range sop.Slots {
		if _, exists := slotIDs[slot.ID]; exists {
			return fmt.Errorf("SOP %q has duplicate slot ID %q", sop.ID, slot.ID)
		}
		slotIDs[slot.ID] = struct{}{}
		if slot.Required && slot.DecisionChanging && strings.TrimSpace(slot.PromptEN) == "" && strings.TrimSpace(slot.PromptZH) == "" {
			return fmt.Errorf("SOP %q required decision-changing slot %q needs a prompt", sop.ID, slot.ID)
		}
	}
	return nil
}

func hasNonBlank(values []string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return true
		}
	}
	return false
}

func cloneSOPs(sops []SOP) []SOP {
	clones := make([]SOP, len(sops))
	for i, sop := range sops {
		clones[i] = cloneSOP(sop)
	}
	return clones
}

func cloneSOP(sop SOP) SOP {
	clone := sop
	clone.Intents = append([]string(nil), sop.Intents...)
	clone.Exclusions = append([]string(nil), sop.Exclusions...)
	clone.Slots = append([]Slot(nil), sop.Slots...)
	clone.AllowedCombinations = append([]string(nil), sop.AllowedCombinations...)
	clone.ApprovalCheckpoints = append([]string(nil), sop.ApprovalCheckpoints...)
	clone.EscalationIndicators = append([]string(nil), sop.EscalationIndicators...)
	clone.DepartmentTags = append([]string(nil), sop.DepartmentTags...)
	return clone
}
