//go:build windows

package rdp

import "testing"

func TestInjectedInputStateTracksAndCollectsShutdownReleases(t *testing.T) {
	state := newInjectedInputState()
	state.record(Input{Type: "key_down", VK: 0x11})
	state.record(Input{Type: "key_down", VK: 0x12, Extended: true})
	state.record(Input{Type: "mouse_down", Button: "left", X: 8, Y: 9})
	state.record(Input{Type: "key_up", VK: 0x11})
	releases := state.releaseInputs()
	if len(state.keys) != 0 || len(state.buttons) != 0 {
		t.Fatalf("state not cleared: keys=%#v buttons=%#v", state.keys, state.buttons)
	}
	key, mouse := false, false
	for _, input := range releases {
		key = key || input.Type == "key_up" && input.VK == 0x12 && input.Extended
		mouse = mouse || input.Type == "mouse_up" && input.Button == "left"
	}
	if !key || !mouse {
		t.Fatalf("shutdown releases = %#v", releases)
	}
}
