package agent

import (
	"context"
	"strings"
)

type memoryCompilerClassificationInputContextKey struct{}

// WithMemoryCompilerClassificationInput carries the user's unexpanded text for
// task classification only. The complete Agent.Run input remains the Memory v5
// source_event so resolved file/resource context is not lost.
func WithMemoryCompilerClassificationInput(ctx context.Context, input string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, memoryCompilerClassificationInputContextKey{}, input)
}

func MemoryCompilerClassificationInputFromContext(ctx context.Context) (string, bool) {
	if ctx == nil {
		return "", false
	}
	v, ok := ctx.Value(memoryCompilerClassificationInputContextKey{}).(string)
	if !ok {
		return "", false
	}
	v = strings.TrimSpace(v)
	return v, v != ""
}

type memoryCompilerSkipContextKey struct{}

// WithMemoryCompilerSkip marks a turn whose input is a synthetic,
// controller-injected message (goal-loop continuation, plan-approved execution,
// stream-recovery retries, …) rather than a genuine user request. Such turns
// must not be compiled into a memory_v5_execution_contract: the contract is
// echoed back by the model and, for the goal loop, re-injected every turn,
// which spins the loop indefinitely (#5342, #5329). Real user turns are
// unaffected and still compile normally.
func WithMemoryCompilerSkip(ctx context.Context) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, memoryCompilerSkipContextKey{}, true)
}

// MemoryCompilerSkipFromContext reports whether the current turn was marked as a
// synthetic message that should bypass Memory v5 compilation.
func MemoryCompilerSkipFromContext(ctx context.Context) bool {
	if ctx == nil {
		return false
	}
	skip, _ := ctx.Value(memoryCompilerSkipContextKey{}).(bool)
	return skip
}
