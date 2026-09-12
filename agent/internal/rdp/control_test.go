package rdp

import "testing"

func TestHeartbeatNegotiationAndWakeCoalescing(t *testing.T) {
	defer HeartbeatControl(nil)
	for len(wake) > 0 {
		<-wake
	}
	HeartbeatControl(nil)
	if controlAvailable.Load() {
		t.Fatal("legacy backend lost polling compatibility")
	}
	pending := false
	HeartbeatControl(&pending)
	if !controlAvailable.Load() || len(wake) != 0 {
		t.Fatal("idle negotiated backend should not poll")
	}
	pending = true
	HeartbeatControl(&pending)
	HeartbeatControl(&pending)
	Wake()
	if len(wake) != 1 {
		t.Fatal("RDP wake requests must coalesce")
	}
	<-wake
	HeartbeatControl(nil)
	if controlAvailable.Load() {
		t.Fatal("fallback was not restored")
	}
}
