//go:build windows

package rdp

import (
	"fmt"
	"strings"
	"time"
)

type encodedVideoFrame struct {
	packet []byte
	flags  uint32
	bytes  int
	encode time.Duration
}

type videoSource interface {
	encode(captureFrame, uint64, time.Time) (encodedVideoFrame, error)
	forceKeyframe() error
	close() error
	codec() string
}

type h264VideoSource struct{ encoder *nativeH264Encoder }

func newH264VideoSource(width, height int) (*h264VideoSource, error) {
	encoder, err := newNativeH264Encoder(width, height, 30, 8_000_000)
	if err != nil {
		return nil, err
	}
	return &h264VideoSource{encoder: encoder}, nil
}
func (s *h264VideoSource) codec() string        { return "h264" }
func (s *h264VideoSource) close() error         { return s.encoder.Close() }
func (s *h264VideoSource) forceKeyframe() error { return s.encoder.ForceKeyframe() }
func (s *h264VideoSource) encode(frame captureFrame, sequence uint64, captured time.Time) (encodedVideoFrame, error) {
	started := time.Now()
	payload, native, err := s.encoder.Encode(frame, sequence, uint64(captured.UnixMicro()))
	if err != nil {
		return encodedVideoFrame{}, err
	}
	if len(payload) == 0 {
		return encodedVideoFrame{encode: time.Since(started)}, nil
	}
	packet, err := h264AccessUnitPacket(H264AccessUnitMetadata{Sequence: native.Sequence, CaptureTimestamp: captured, EncodeTimestamp: time.Now(), Flags: native.Flags}, payload)
	if err != nil {
		return encodedVideoFrame{}, err
	}
	return encodedVideoFrame{packet: packet, flags: native.Flags, bytes: len(payload), encode: time.Since(started)}, nil
}
func (s *h264VideoSource) description() (string, bool, error) {
	info, err := s.encoder.Info()
	if err != nil {
		return "", false, err
	}
	return strings.TrimRight(string(info.Name[:]), "\x00"), info.Hardware != 0, nil
}

type jpegVideoSource struct{}

func (jpegVideoSource) codec() string        { return "jpeg" }
func (jpegVideoSource) close() error         { return nil }
func (jpegVideoSource) forceKeyframe() error { return fmt.Errorf("JPEG has no keyframe control") }
func (jpegVideoSource) encode(frame captureFrame, sequence uint64, captured time.Time) (encodedVideoFrame, error) {
	jpg, timing, err := encodeCaptureFrame(frame)
	if err != nil {
		return encodedVideoFrame{}, err
	}
	packet, err := framePacket(FrameMetadata{Sequence: sequence, CaptureTimestamp: captured}, jpg)
	if err != nil {
		return encodedVideoFrame{}, err
	}
	return encodedVideoFrame{packet: packet, bytes: len(jpg), encode: timing.jpegEncode}, nil
}
