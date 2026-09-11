package update

import "testing"

func TestHeartbeatRequiresAuthenticatedIdentity(t *testing.T) {
	if !authenticatedHeartbeat("https://example.invalid", "device", "device", true) {
		t.Fatal("valid authenticated heartbeat rejected")
	}
	for _, c := range []struct {
		server, expected, response string
		ok                         bool
	}{
		{"http://example.invalid", "device", "device", true},
		{"https://example.invalid", "device", "other", true},
		{"https://example.invalid", "device", "device", false},
		{"https://example.invalid", "", "", true},
	} {
		if authenticatedHeartbeat(c.server, c.expected, c.response, c.ok) {
			t.Fatal("invalid health heartbeat accepted")
		}
	}
}
