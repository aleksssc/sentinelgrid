package rdp

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestConnectionValidation(t *testing.T) {
	valid := Connection{Relay: "wss://relay.example/rdp", Ticket: strings.Repeat("a", 43), ExpiresAt: time.Now().Add(time.Minute)}
	if err := valid.Validate(); err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{"ws://relay.example/rdp", "https://relay.example/rdp", "wss://relay.example/rdp?ticket=x", "wss://relay.example/other"} {
		candidate := valid
		candidate.Relay = value
		if candidate.Validate() == nil {
			t.Fatalf("accepted %s", value)
		}
	}
}

func TestRemoteInputValidation(t *testing.T) {
	valid, _ := json.Marshal(Input{Type: "mouse_move", X: 20, Y: 30})
	if _, err := parseInput(append([]byte{PacketInput}, valid...)); err != nil {
		t.Fatal(err)
	}
	for _, input := range []Input{{Type: "mouse_move", X: -1}, {Type: "mouse_down", Button: "bad"}, {Type: "mouse_wheel"}, {Type: "key_down"}} {
		data, _ := json.Marshal(input)
		if _, err := parseInput(append([]byte{PacketInput}, data...)); err == nil {
			t.Fatalf("accepted %#v", input)
		}
	}
}

func TestScreenInfoPacket(t *testing.T) {
	if _, err := infoPacket(ScreenInfo{Type: "screen_info", Width: 1920, Height: 1080}); err != nil {
		t.Fatal(err)
	}
	if _, err := infoPacket(ScreenInfo{Width: 0, Height: 1080}); err == nil {
		t.Fatal("accepted invalid dimensions")
	}
}
