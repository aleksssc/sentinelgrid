package inventory

import (
	"context"
	"log"
	"time"

	"sentinelgrid/agent/internal/rdp"
)

func RefreshRemoteCapabilities(value *Inventory) {
	if value == nil {
		return
	}
	if value.Capabilities == nil {
		value.Capabilities = make(map[string]bool)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err := rdp.Available(ctx)
	available := err == nil
	if value.Capabilities["rdp"] && !available {
		log.Printf("RDP capability withdrawn: %v", err)
	}
	value.Capabilities["rdp"] = available
	value.Capabilities["tcp_tunnel"] = available
}
