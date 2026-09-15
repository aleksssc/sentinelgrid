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
	// Completion follows all control sends. Selecting it alongside buffered
	// controls can falsely fail even when every packet was routed correctly.
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("reader did not finish after the peer sent all controls and closed")
	}
	close(controls)
	var gotCaps bool
	keyframes := 0
	for control := range controls {
		if control.capabilities != nil {
			gotCaps = supportsH264(*control.capabilities)
		}
		if control.keyframe {
			keyframes++
		}
	}
	if !gotCaps || keyframes != 1 {
		t.Fatalf("capabilities=%t keyframes=%d, want H264 capabilities and one rate-limited keyframe request", gotCaps, keyframes)
	}
}

func TestLegacyVideoSelectionRemainsJPEG(t *testing.T) {
	selected := selectVideo(VideoCapabilities{Version: videoProtocolVersion, Codecs: []string{"jpeg"}}, 1280, 720)
	if selected.Codec != "jpeg" || selected.Format != "jpeg" {
		t.Fatalf("legacy viewer selection = %+v, want JPEG", selected)
	}
}
