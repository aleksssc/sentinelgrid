//go:build windows

package rdp

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestReadRemoteInputRoutesAndRateLimitsKeyframeControl(t *testing.T) {
	upgrader := websocket.Upgrader{}
	capabilities, err := videoControlPacket(PacketVideoCapabilities, VideoCapabilities{Version: videoProtocolVersion, Codecs: []string{"h264", "jpeg"}})
	if err != nil {
		t.Fatal(err)
	}
	keyframe, err := videoControlPacket(PacketVideoKeyframe, KeyframeRequest{Reason: "transport_test"})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, upgradeErr := upgrader.Upgrade(w, r, nil)
		if upgradeErr != nil {
			t.Error(upgradeErr)
			return
		}
		defer ws.Close()
		for _, packet := range [][]byte{capabilities, keyframe, keyframe} {
			if writeErr := ws.WriteMessage(websocket.BinaryMessage, packet); writeErr != nil {
				t.Error(writeErr)
				return
			}
		}
	}))
	defer server.Close()
	client, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan remoteInputResult, 1)
	controls := make(chan remoteControl, 3)
	go readRemoteInput(ctx, client, done, controls)
	var gotCaps bool
	keyframes := 0
	deadline := time.After(time.Second)
	for !gotCaps || keyframes != 1 {
		select {
		case control := <-controls:
			if control.capabilities != nil {
				gotCaps = supportsH264(*control.capabilities)
			}
			if control.keyframe {
				keyframes++
			}
		case result := <-done:
			t.Fatalf("reader stopped before controls were routed: %+v", result)
		case <-deadline:
			t.Fatalf("capabilities=%t keyframes=%d", gotCaps, keyframes)
		}
	}
	if keyframes != 1 {
		t.Fatalf("rate limiter forwarded %d keyframe requests", keyframes)
	}
}

func TestLegacyVideoSelectionRemainsJPEG(t *testing.T) {
	selected := selectVideo(VideoCapabilities{Version: videoProtocolVersion, Codecs: []string{"jpeg"}}, 1280, 720)
	if selected.Codec != "jpeg" || selected.Format != "jpeg" {
		t.Fatalf("legacy viewer selection = %+v, want JPEG", selected)
	}
}
