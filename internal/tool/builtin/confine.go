package builtin

import (
	"reasonix/internal/netclient"
	"reasonix/internal/sandbox"
	"reasonix/internal/tool"
)

func ConfineWriters(tools []tool.Tool, roots []string) {}
func ConfineBash(tools []tool.Tool, spec sandbox.Spec) {}
func ConfineWebFetch(tools []tool.Tool, spec netclient.ProxySpec) {}
func ConfineReaders(tools []tool.Tool, forbidRoots []string) {}
