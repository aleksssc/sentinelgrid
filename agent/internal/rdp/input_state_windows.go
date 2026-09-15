//go:build windows

package rdp

import "sync"

// injectedInputState serializes SendInput and remembers every state transition
// SentinelGrid introduced, so shutdown can always restore the local desktop.
type injectedInputState struct {
	mu      sync.Mutex
	keys    map[uint16]Input
	buttons map[string]Input
}

func newInjectedInputState() *injectedInputState {
	return &injectedInputState{keys: make(map[uint16]Input), buttons: make(map[string]Input)}
}

func (s *injectedInputState) inject(input Input) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := sendInputRecord(input); err != nil {
		return err
	}
	s.record(input)
	return nil
}

func (s *injectedInputState) record(input Input) {
	switch input.Type {
	case "key_down":
		s.keys[input.VK] = input
	case "key_up":
		delete(s.keys, input.VK)
	case "mouse_down":
		s.buttons[input.Button] = input
	case "mouse_up":
		delete(s.buttons, input.Button)
	}
}

func (s *injectedInputState) releaseAll() {
	for _, input := range s.releaseInputs() {
		_ = sendInputRecord(input)
	}
}
func (s *injectedInputState) releaseInputs() []Input {
	s.mu.Lock()
	defer s.mu.Unlock()
	releases := make([]Input, 0, len(s.keys)+len(s.buttons))
	for _, input := range s.keys {
		input.Type = "key_up"
		releases = append(releases, input)
	}
	for _, input := range s.buttons {
		input.Type = "mouse_up"
		releases = append(releases, input)
	}
	s.keys = make(map[uint16]Input)
	s.buttons = make(map[string]Input)
	return releases
}
