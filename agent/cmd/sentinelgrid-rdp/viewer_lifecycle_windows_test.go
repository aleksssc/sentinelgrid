//go:build windows

package main

import (
	"errors"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"sentinelgrid/agent/internal/rdp"
)

func TestViewerFirstD3DPresentAndFinalStates(t *testing.T) {
	v := &viewer{sessionState: viewerStateNegotiatingVideo, presentMetrics: newDurationWindow(120)}
	v.recordRendererResult(errors.New("present failed"), 1, time.Millisecond)
	if v.sessionState != viewerStateNegotiatingVideo {
		t.Fatal("failed presentation connected")
	}
	v.recordRendererResult(nil, 2, time.Millisecond)
	if v.sessionState != viewerStateConnected {
		t.Fatal("successful D3D presentation did not connect")
	}
	for _, terminal := range []viewerSessionState{viewerStateSessionEnded, viewerStateConnectionLost, viewerStateDisconnecting} {
		v := &viewer{sessionState: terminal, presentMetrics: newDurationWindow(120), ws: &websocket.Conn{}, frameGeneration: 1}
		v.setSessionState(viewerStateNegotiatingVideo)
		v.recordRendererResult(nil, 1, time.Millisecond)
		if v.sessionState != terminal {
			t.Fatalf("late event revived %s", terminal.label())
		}
		if v.inputEnabled() {
			t.Fatalf("input enabled in %s", terminal.label())
		}
		v.presentLatestFrame(1)
		if v.notification.lastAttemptedGeneration != 0 {
			t.Fatal("terminal frame was presented over disconnected UI")
		}
	}
}

func TestViewerStateTransitionContract(t *testing.T) {
	for _, state := range []viewerSessionState{viewerStateLaunching, viewerStateConnecting, viewerStateNegotiatingVideo, viewerStateConnected, viewerStateDisconnecting, viewerStateSessionEnded, viewerStateConnectionLost} {
		if state.canTransition(viewerStateConnected) && state != viewerStateNegotiatingVideo && state != viewerStateConnected {
			t.Fatalf("%s connected without first present", state.label())
		}
	}
	for _, code := range []int{1000, 1001, 1011, 1006, 1008} {
		category := relayCloseCategory(&websocket.CloseError{Code: code})
		expected := viewerStateConnectionLost
		if code == 1000 || code == 1001 {
			expected = viewerStateSessionEnded
		}
		if got := viewerTerminalState(false, category); got != expected {
			t.Fatalf("close %d -> %s", code, got.label())
		}
	}
}

func TestViewerLocalCloseActionsDoNotWaitForNetwork(t *testing.T) {
	for _, action := range []string{"disconnect", "native_x", "alt_f4"} {
		t.Run(action, func(t *testing.T) {
			v := &viewer{sessionState: viewerStateConnected, compressed: newLatestCompressedFrame()}
			switch action {
			case "disconnect":
				v.shellAction("disconnect")
			case "native_x":
				v.beginShutdown()
			case "alt_f4":
				if !v.localShellKey(wmSysKeyDown, 0x73, 1<<29) {
					t.Fatal("Alt+F4 not consumed locally")
				}
			}
			if !v.wasCloseRequested() || v.sessionState != viewerStateDisconnecting || v.inputEnabled() {
				t.Fatal("local close misclassified")
			}
			v.setSessionState(viewerStateConnectionLost)
			if v.sessionState != viewerStateDisconnecting {
				t.Fatal("close completion became connection loss")
			}
			select {
			case <-v.shutdownDone:
			case <-time.After(2 * time.Second):
				t.Fatal("cleanup did not finish")
			}
		})
	}
}

func TestFocusLossEnqueuesOrderedReleasesWithoutNetwork(t *testing.T) {
	s := &viewerInputSender{keys: make(map[uint16]rdp.Input), buttons: make(map[string]rdp.Input)}
	s.enqueueCritical(rdp.Input{Type: "key_down", VK: 0x11, Extended: true})
	s.enqueueCritical(rdp.Input{Type: "mouse_down", Button: "left", X: 24, Y: 30})
	s.releaseOnFocusLoss()
	events := queuedCritical(s)
	if len(events) != 4 || events[0].Type != "key_down" || events[1].Type != "mouse_down" || events[2].Type != "key_up" || !events[2].Extended || events[3].Type != "mouse_up" {
		t.Fatalf("unordered synthetic release: %+v", events)
	}
	if len(s.keys) != 0 || len(s.buttons) != 0 {
		t.Fatal("held state not cleared")
	}
}

func TestFocusReleaseSurvivesImmediateLocalShutdown(t *testing.T) {
	s := &viewerInputSender{keys: map[uint16]rdp.Input{0x11: {Type: "key_down", VK: 0x11}}, buttons: make(map[string]rdp.Input)}
	s.releaseOnFocusLoss()
	releases := s.releaseEvents()
	if len(releases) != 1 || releases[0].Type != "key_up" {
		t.Fatalf("shutdown discarded pending focus release: %+v", releases)
	}
}

func TestFullscreenRestoreNeverMovesOrSizesToZero(t *testing.T) {
	if fullscreenRestoreFlags&(swpNoSize|swpNoMove) != swpNoSize|swpNoMove {
		t.Fatal("frame refresh overwrites restored placement with zero dimensions")
	}
}

func TestTerminalCloseHitTargetAndToolbarIsolation(t *testing.T) {
	for _, size := range [][2]int{{1280, 800}, {800, 600}, {1920, 1080}} {
		area := terminalCloseRect(size[0], size[1])
		if !area.contains(area.x+1, area.y+1) || area.contains(0, 0) {
			t.Fatal("terminal Close target mismatch")
		}
		layout := viewerLayoutForClient(size[0], size[1])
		for _, name := range []string{"fit", "fullscreen", "stats", "disconnect"} {
			button := layout.buttons[name]
			if button.y+button.height > layout.video.y || layout.actionAt(button.x+1, button.y+1) != name {
				t.Fatalf("toolbar/video overlap: %s", name)
			}
		}
		if len(layout.buttons) != 4 {
			t.Fatal("nonfunctional toolbar controls returned")
		}
	}
}
