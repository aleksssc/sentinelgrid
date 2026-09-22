package rdp

import (
	"bytes"
	"testing"
	"time"
)

func TestH264AccessUnitRoundTrip(t *testing.T) {
	in := []byte{0, 0, 0, 1, 0x67, 1, 0, 0, 0, 1, 0x68, 1, 0, 0, 0, 1, 0x65, 1}
	p, err := h264AccessUnitPacket(H264AccessUnitMetadata{Sequence: 9, CaptureTimestamp: time.UnixMicro(4), Flags: H264FlagKeyframe | H264FlagConfig}, in)
	if err != nil {
		t.Fatal(err)
	}
	m, out, err := parseH264AccessUnitPacket(p)
	if err != nil || m.Sequence != 9 || m.Flags != (H264FlagKeyframe|H264FlagConfig) || !bytes.Equal(out, in) {
		t.Fatalf("%+v %x %v", m, out, err)
	}
}
func TestVideoSelectionRequiresExplicitCapability(t *testing.T) {
	jpeg := selectVideo(VideoCapabilities{Version: videoProtocolVersion, Codecs: []string{"jpeg"}}, 1920, 1080)
	if jpeg.Codec != "jpeg" {
		t.Fatal(jpeg)
	}
	h264 := selectVideo(VideoCapabilities{Version: videoProtocolVersion, Codecs: []string{"jpeg", "h264"}}, 1920, 1080)
	if h264.Codec != "h264" || h264.Format != "annexb" {
		t.Fatal(h264)
	}
}
func TestVideoPacketTypesDoNotCollide(t *testing.T) {
	seen := map[byte]bool{}
	for _, kind := range []byte{PacketFrame, PacketInput, PacketInfo, PacketVideoCapabilities, PacketVideoSelected, PacketH264Config, PacketH264AccessUnit, PacketVideoKeyframe, PacketInputControl} {
		if seen[kind] {
			t.Fatalf("collision %d", kind)
		}
		seen[kind] = true
	}
}
func TestCapabilityAndKeyframeValidation(t *testing.T) {
	p, err := videoControlPacket(PacketVideoCapabilities, VideoCapabilities{Version: videoProtocolVersion, Codecs: []string{"jpeg"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = parseVideoCapabilities(p); err != nil {
		t.Fatal(err)
	}
	if _, err = parseKeyframeRequest([]byte{PacketVideoKeyframe, '{', '}'}); err == nil {
		t.Fatal("accepted empty keyframe reason")
	}
}
func TestH264GOPQueueDropsDependentFramesUntilIDR(t *testing.T) {
	q := newH264GOPQueue(2)
	if !q.enqueue([]byte("p"), 0) {
		t.Fatal("P frame must require recovery")
	}
	q.enqueue([]byte("idr"), H264FlagKeyframe|H264FlagConfig)
	q.enqueue([]byte("p2"), 0)
	if got := string(q.dequeue()); got != "idr" {
		t.Fatal(got)
	}
	if got := string(q.dequeue()); got != "p2" {
		t.Fatal(got)
	}
	q.enqueue([]byte("idr2"), H264FlagKeyframe|H264FlagConfig)
	q.enqueue([]byte("p3"), 0)
	q.enqueue([]byte("p4"), 0)
	if drops, _, forced := q.stats(); drops == 0 || forced == 0 {
		t.Fatalf("drops=%d forced=%d", drops, forced)
	}
}


func TestInputControlValidation(t *testing.T) {
	for _, mode := range []string{"full", "view"} {
		packet, err := videoControlPacket(PacketInputControl, InputControl{Mode: mode, BlockLocalInput: mode == "full"})
		if err != nil {
			t.Fatal(err)
		}
		control, err := parseInputControl(packet)
		if err != nil {
			t.Fatal(err)
		}
		if control.Mode != mode {
			t.Fatalf("mode = %q, want %q", control.Mode, mode)
		}
	}
	packet, err := videoControlPacket(PacketInputControl, InputControl{Mode: "invalid"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := parseInputControl(packet); err == nil {
		t.Fatal("invalid input mode was accepted")
	}
}
