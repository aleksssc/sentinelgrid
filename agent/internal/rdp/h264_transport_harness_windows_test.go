//go:build windows

package rdp

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"
)

// TestH264TransportHarness is an opt-in live viewer harness. It deliberately
// uses Dial and the production packet parsers; supplying a paired host ticket
// exercises host -> h264Writer -> relay -> viewer without a decoder.
func TestH264TransportHarness(t *testing.T) {
	relay, ticket, expires := os.Getenv("SENTINELGRID_H264_HARNESS_RELAY"), os.Getenv("SENTINELGRID_H264_HARNESS_TICKET"), os.Getenv("SENTINELGRID_H264_HARNESS_EXPIRES")
	if relay == "" || ticket == "" || expires == "" {
		t.Skip("live H.264 harness requires SENTINELGRID_H264_HARNESS_RELAY, _TICKET, and _EXPIRES for a paired host session")
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, expires)
	if err != nil {
		t.Fatal(err)
	}
	ws, err := Dial(context.Background(), Connection{Relay: relay, Ticket: ticket, ExpiresAt: expiresAt})
	if err != nil {
		t.Fatal(err)
	}
	clean := false
	defer func() {
		_ = ws.Close()
		fmt.Printf("SESSION_CLOSED_CLEANLY=%t\n", clean)
	}()
	capabilities, err := videoControlPacket(PacketVideoCapabilities, VideoCapabilities{Version: videoProtocolVersion, Codecs: []string{"h264", "jpeg"}})
	if err != nil {
		t.Fatal(err)
	}
	if err = writePacket(ws, capabilities); err != nil {
		t.Fatal(err)
	}
	selected, aus, totalBytes := "", 0, 0
	ordered, sps, pps, idr, nonIDR, requested, recovery := true, false, false, false, false, false, false
	var previous uint64
	deadline := time.Now().Add(45 * time.Second)
	for time.Now().Before(deadline) {
		if err = ws.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
			t.Fatal(err)
		}
		kind, data, readErr := ws.ReadMessage()
		if readErr != nil {
			t.Fatalf("receive H.264 access unit: %v", readErr)
		}
		if kind != 2 || len(data) == 0 {
			continue
		}
		if data[0] == PacketVideoSelected {
			var selection VideoSelected
			if err = parseVideoControl(PacketVideoSelected, data, &selection); err != nil {
				t.Fatal(err)
			}
			if selection.Codec != "h264" || selection.Format != "annexb" {
				t.Fatalf("video selection codec=%s format=%s", selection.Codec, selection.Format)
			}
			selected = selection.Codec
			continue
		}
		if data[0] != PacketH264AccessUnit {
			continue
		}
		metadata, annexB, parseErr := parseH264AccessUnitPacket(data)
		if parseErr != nil {
			t.Fatal(parseErr)
		}
		if aus > 0 && metadata.Sequence <= previous {
			ordered = false
		}
		previous = metadata.Sequence
		aus++
		totalBytes += len(annexB)
		for _, nalType := range annexBNALTypes(annexB) {
			sps = sps || nalType == 7
			pps = pps || nalType == 8
			idr = idr || nalType == 5
			nonIDR = nonIDR || nalType == 1
			if requested && nalType == 5 {
				recovery = true
			}
		}
		if selected != "h264" || !ordered || !sps || !pps || !idr || !nonIDR {
			continue
		}
		if !requested {
			request, requestErr := videoControlPacket(PacketVideoKeyframe, KeyframeRequest{Reason: "h264_transport_harness"})
			if requestErr != nil {
				t.Fatal(requestErr)
			}
			if requestErr = writePacket(ws, request); requestErr != nil {
				t.Fatal(requestErr)
			}
			requested = true
			continue
		}
		if recovery {
			clean = true
			break
		}
	}
	fmt.Printf("VIDEO_SELECTED=%s\nAUS_RECEIVED=%d\nTOTAL_BYTES=%d\nSEQUENCE_ORDER_OK=%t\nSPS_FOUND=%t\nPPS_FOUND=%t\nIDR_FOUND=%t\nNON_IDR_FOUND=%t\nKEYFRAME_REQUEST_SENT=%t\nRECOVERY_IDR_FOUND=%t\n", selected, aus, totalBytes, ordered, sps, pps, idr, nonIDR, requested, recovery)
	if selected != "h264" || !ordered || !sps || !pps || !idr || !nonIDR || !requested || !recovery {
		t.Fatal("H.264 transport harness requirements were not met")
	}
}

func annexBNALTypes(data []byte) []byte {
	var types []byte
	for i := 0; i+3 < len(data); {
		start := 0
		if data[i] == 0 && data[i+1] == 0 && data[i+2] == 1 {
			start = i + 3
		} else if i+4 < len(data) && data[i] == 0 && data[i+1] == 0 && data[i+2] == 0 && data[i+3] == 1 {
			start = i + 4
		} else {
			i++
			continue
		}
		if start < len(data) {
			types = append(types, data[start]&0x1f)
		}
		i = start
	}
	return types
}
