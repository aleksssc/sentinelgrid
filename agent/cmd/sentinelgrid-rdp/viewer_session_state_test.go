package main

import "testing"

func TestFirstSuccessfulPresentConnectsNegotiatingViewer(t *testing.T) {
	viewer := &viewer{logger: &viewerLogger{}, sessionState: viewerStateNegotiatingVideo}
	viewer.recordPaintResult(1080, 1920, 1080, 1280, 720, 1)
	if viewer.sessionState != viewerStateConnected {
		t.Fatalf("state after first successful present = %s, want Connected", viewer.sessionState.label())
	}
}

func TestViewerTerminalStateClassifiesLocalNormalAndAbnormalEnds(t *testing.T) {
	for _, test := range []struct {
		name       string
		localClose bool
		category   string
		want       viewerSessionState
	}{
		{"local disconnect", true, "abnormal", viewerStateDisconnecting},
		{"native close", true, "normal", viewerStateDisconnecting},
		{"normal peer close", false, "normal", viewerStateSessionEnded},
		{"going away peer close", false, "going_away", viewerStateSessionEnded},
		{"internal server error", false, "websocket_close", viewerStateConnectionLost},
		{"network failure", false, "network_error", viewerStateConnectionLost},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := viewerTerminalState(test.localClose, test.category); got != test.want {
				t.Fatalf("viewerTerminalState(%t, %q) = %s, want %s", test.localClose, test.category, got.label(), test.want.label())
			}
		})
	}
}

func TestTerminalViewerDisablesInput(t *testing.T) {
	viewer := &viewer{sessionState: viewerStateConnectionLost}
	if !viewer.sessionState.terminal() {
		t.Fatal("connection loss must be terminal")
	}
}
