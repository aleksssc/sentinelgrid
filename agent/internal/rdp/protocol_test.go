package rdp

import (
	"bytes"
	"testing"
	"time"
)

func TestFramePacketCarriesSequenceAndCaptureTimestamp(t *testing.T) {
	captured := time.UnixMicro(123456789)
	packet, err := framePacket(FrameMetadata{Sequence: 42, CaptureTimestamp: captured}, []byte{0xff, 0xd8, 0xff})
	if err != nil {
		t.Fatal(err)
	}
	metadata, jpeg, err := parseFramePacket(packet)
	if err != nil {
		t.Fatal(err)
	}
	if metadata.Sequence != 42 || !metadata.CaptureTimestamp.Equal(captured) || !bytes.Equal(jpeg, []byte{0xff, 0xd8, 0xff}) {
		t.Fatalf("unexpected parsed frame: %#v %#v", metadata, jpeg)
	}
}

func TestParseFramePacketAcceptsLegacyJPEG(t *testing.T) {
	legacy := []byte{PacketFrame, 0xff, 0xd8, 0xff}
	metadata, jpeg, err := parseFramePacket(legacy)
	if err != nil || metadata.Sequence != 0 || !bytes.Equal(jpeg, legacy[1:]) {
		t.Fatalf("legacy parsing failed: %#v %#v %v", metadata, jpeg, err)
	}
}
