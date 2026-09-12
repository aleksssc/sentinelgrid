package realtime

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestRealtimeDiscovery(t *testing.T) {
	for _, test := range []struct {
		name   string
		status int
		body   string
		want   string
		fail   bool
	}{
		{"standalone", 200, `{"origin":"wss://realtime.example"}`, "wss://realtime.example/api/realtime/agent", false},
		{"legacy backend", 404, "", "legacy", false},
		{"unset", 200, `{"origin":null}`, "legacy", false},
		{"outage", 503, "", "", true},
		{"redirect", 302, "", "", true},
		{"empty", 200, `{}`, "", true},
		{"empty origin", 200, `{"origin":""}`, "", true},
		{"cleartext", 200, `{"origin":"ws://realtime.example"}`, "", true},
		{"credentials", 200, `{"origin":"wss://user:secret@realtime.example"}`, "", true},
		{"path", 200, `{"origin":"wss://realtime.example/wrong"}`, "", true},
		{"query", 200, `{"origin":"wss://realtime.example?token=secret"}`, "", true},
		{"fragment", 200, `{"origin":"wss://realtime.example#"}`, "", true},
		{"oversize", 200, strings.Repeat(" ", 4097), "", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/api/realtime/endpoint" || r.Header.Get("Authorization") != "" {
					t.Error("Unexpected discovery request")
				}
				if test.status == 302 {
					w.Header().Set("Location", "https://untrusted.example")
				}
				w.WriteHeader(test.status)
				_, _ = w.Write([]byte(test.body))
			}))
			defer server.Close()
			got, err := discoverWebSocketURL(context.Background(), server.URL)
			if (err != nil) != test.fail {
				t.Fatalf("error = %v", err)
			}
			want := test.want
			if want == "legacy" {
				want = strings.Replace(server.URL, "http:", "ws:", 1) + "/api/realtime/agent"
			}
			if !test.fail && got != want {
				t.Fatalf("got %q, want %q", got, want)
			}
		})
	}
}

func TestRealtimeDiscoveryRejectsUnsafeOriginAndCancellation(t *testing.T) {
	for _, origin := range []string{"http://public.example", "https://user:secret@example.com", "", "ftp://example.com"} {
		if _, err := discoverWebSocketURL(context.Background(), origin); err == nil {
			t.Fatalf("accepted %q", origin)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := discoverWebSocketURL(ctx, "https://example.com"); err == nil {
		t.Fatal("ignored cancellation")
	}
}

func TestReconnectBackoffBounds(t *testing.T) {
	var delay time.Duration
	for i := 0; i < 20; i++ {
		delay = nextReconnectDelay(delay)
		if delay < 5*time.Second || delay > 5*time.Minute {
			t.Fatalf("invalid delay %v", delay)
		}
		for j := 0; j < 100; j++ {
			got := jitterReconnectDelay(delay)
			if got < delay/2 || got > delay {
				t.Fatalf("invalid jitter %v for %v", got, delay)
			}
		}
	}
	if delay != 5*time.Minute {
		t.Fatal("backoff did not reach cap")
	}
}
