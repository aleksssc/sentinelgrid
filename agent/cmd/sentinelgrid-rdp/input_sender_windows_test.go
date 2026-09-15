//go:build windows

package main

import (
	"testing"

	"sentinelgrid/agent/internal/rdp"
)

func queuedCritical(sender *viewerInputSender) []rdp.Input {
	var result []rdp.Input
	for {
		input, move, ok := sender.next()
		if !ok {
			return result
		}
		if move {
			continue
		}
		result = append(result, input)
	}
}

func TestViewerInputSenderTracksKeyboardTransitions(t *testing.T) {
	s := &viewerInputSender{keys: make(map[uint16]rdp.Input), buttons: make(map[string]rdp.Input)}
	for _, key := range []rdp.Input{{Type: "key_down", VK: 0x11}, {Type: "key_down", VK: 0x11}, {Type: "key_up", VK: 0x11}, {Type: "key_down", VK: 0x10}, {Type: "key_up", VK: 0x10}, {Type: "key_down", VK: 0x12, Extended: true}, {Type: "key_up", VK: 0x12, Extended: true}} {
		s.enqueueCritical(key)
	}
	got := queuedCritical(s)
	want := []rdp.Input{{Type: "key_down", VK: 0x11}, {Type: "key_up", VK: 0x11}, {Type: "key_down", VK: 0x10}, {Type: "key_up", VK: 0x10}, {Type: "key_down", VK: 0x12, Extended: true}, {Type: "key_up", VK: 0x12, Extended: true}}
	if len(got) != len(want) {
		t.Fatalf("events = %#v, want %#v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("event %d = %#v, want %#v", i, got[i], want[i])
		}
	}
	if len(s.keys) != 0 {
		t.Fatalf("held keys remain: %#v", s.keys)
	}
}

func TestViewerInputSenderRetainsReleasesPastQueueSaturation(t *testing.T) {
	s := &viewerInputSender{keys: make(map[uint16]rdp.Input), buttons: make(map[string]rdp.Input)}
	for key := uint16(1); key <= 255; key++ {
		s.enqueueCritical(rdp.Input{Type: "key_down", VK: key})
	}
	s.enqueueCritical(rdp.Input{Type: "key_up", VK: 0x11})
	for i := 0; i < 700; i++ {
		s.enqueueMouseMove(rdp.Input{Type: "mouse_move", X: i, Y: i})
	}
	for i := 0; i < 256; i++ {
		input, move, ok := s.next()
		if !ok || move {
			t.Fatalf("critical event %d was not preserved", i)
		}
		if i == 255 && (input.Type != "key_up" || input.VK != 0x11) {
			t.Fatalf("critical release was lost or reordered: %#v", input)
		}
	}
	if s.move == nil || s.move.X != 699 {
		t.Fatalf("moves were not coalesced to latest: %#v", s.move)
	}
}

func TestViewerInputSenderFocusReleaseEventsClearHeldState(t *testing.T) {
	s := &viewerInputSender{keys: map[uint16]rdp.Input{0x11: {Type: "key_down", VK: 0x11}}, buttons: map[string]rdp.Input{"left": {Type: "mouse_down", Button: "left", X: 20, Y: 30}}}
	releases := s.releaseEvents()
	if len(releases) != 2 || len(s.keys) != 0 || len(s.buttons) != 0 {
		t.Fatalf("focus release did not clear state: events=%#v keys=%#v buttons=%#v", releases, s.keys, s.buttons)
	}
	seenKey, seenButton := false, false
	for _, input := range releases {
		seenKey = seenKey || input.Type == "key_up" && input.VK == 0x11
		seenButton = seenButton || input.Type == "mouse_up" && input.Button == "left"
	}
	if !seenKey || !seenButton {
		t.Fatalf("missing synthetic releases: %#v", releases)
	}
}

func TestKeyboardInputPreservesSystemAndExtendedMetadata(t *testing.T) {
	input := keyboardInput("key_up", 0x12, (uintptr(0x38)<<16)|(uintptr(1)<<24))
	if input.Type != "key_up" || input.VK != 0x12 || input.Scan != 0x38 || !input.Extended {
		t.Fatalf("keyboard metadata = %#v", input)
	}
	if !isSentinelGridInputTag(sentinelGridInputTag) || isSentinelGridInputTag(0) {
		t.Fatal("input tag classification is incorrect")
	}
}
