package rdp

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"time"
)

const (
	PacketFrame             byte = 1 // JPEG frame; retained for legacy peers.
	PacketInput             byte = 2
	PacketInfo              byte = 3
	PacketVideoCapabilities byte = 4
	PacketVideoSelected     byte = 5
	PacketH264Config        byte = 6
	PacketH264AccessUnit    byte = 7
	PacketVideoKeyframe     byte = 8
	maxRemotePacket              = 8 * 1024 * 1024
	frameHeaderSize              = 20
	h264HeaderSize               = 28
	videoProtocolVersion         = 1
)

var (
	frameMagic = [4]byte{'S', 'G', 'F', '1'}
	h264Magic  = [4]byte{'S', 'G', 'H', '1'}
)

const (
	H264FlagKeyframe uint32 = 1 << iota
	H264FlagConfig
)

type FrameMetadata struct {
	Sequence         uint64
	CaptureTimestamp time.Time
}

type H264AccessUnitMetadata struct {
	Sequence         uint64
	CaptureTimestamp time.Time
	EncodeTimestamp  time.Time
	Flags            uint32
}

type VideoCapabilities struct {
	Version  int      `json:"version"`
	Codecs   []string `json:"codecs"`
	Renderer []string `json:"renderer"`
}

type VideoSelected struct {
	Version int    `json:"version"`
	Codec   string `json:"codec"`
	Width   int    `json:"width"`
	Height  int    `json:"height"`
	FPS     int    `json:"fps"`
	Format  string `json:"format"`
}

type KeyframeRequest struct {
	Reason string `json:"reason"`
}

type ScreenInfo struct {
	Type   string `json:"type"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}
type Input struct {
	Type   string `json:"type"`
	X      int    `json:"x,omitempty"`
	Y      int    `json:"y,omitempty"`
	Button string `json:"button,omitempty"`
	Delta  int    `json:"delta,omitempty"`
	VK     uint16 `json:"vk,omitempty"`
}

func packet(kind byte, value []byte) ([]byte, error) {
	if len(value) > maxRemotePacket-1 {
		return nil, fmt.Errorf("remote packet too large")
	}
	return append([]byte{kind}, value...), nil
}

func framePacket(metadata FrameMetadata, jpeg []byte) ([]byte, error) {
	if len(jpeg) > maxRemotePacket-1-frameHeaderSize {
		return nil, fmt.Errorf("remote frame too large")
	}
	data := make([]byte, 1+frameHeaderSize+len(jpeg))
	data[0] = PacketFrame
	copy(data[1:5], frameMagic[:])
	binary.BigEndian.PutUint64(data[5:13], metadata.Sequence)
	binary.BigEndian.PutUint64(data[13:21], uint64(metadata.CaptureTimestamp.UnixMicro()))
	copy(data[21:], jpeg)
	return data, nil
}
func parseFramePacket(data []byte) (FrameMetadata, []byte, error) {
	if len(data) < 2 || data[0] != PacketFrame {
		return FrameMetadata{}, nil, fmt.Errorf("invalid remote frame")
	}
	payload := data[1:]
	if len(payload) < frameHeaderSize || string(payload[:4]) != string(frameMagic[:]) {
		return FrameMetadata{}, payload, nil
	}
	timestamp := int64(binary.BigEndian.Uint64(payload[12:20]))
	if timestamp <= 0 || len(payload[20:]) == 0 {
		return FrameMetadata{}, nil, fmt.Errorf("invalid remote frame metadata")
	}
	return FrameMetadata{Sequence: binary.BigEndian.Uint64(payload[4:12]), CaptureTimestamp: time.UnixMicro(timestamp)}, payload[20:], nil
}
func ParseFramePacket(data []byte) (FrameMetadata, []byte, error) { return parseFramePacket(data) }

// H.264 packets always carry a complete Annex B access unit. A keyframe packet
// includes SPS/PPS before its IDR so a decoder can begin after loss or a reset.
func h264AccessUnitPacket(metadata H264AccessUnitMetadata, annexB []byte) ([]byte, error) {
	if len(annexB) == 0 || len(annexB) > maxRemotePacket-1-h264HeaderSize {
		return nil, fmt.Errorf("invalid H.264 access unit size")
	}
	data := make([]byte, 1+h264HeaderSize+len(annexB))
	data[0] = PacketH264AccessUnit
	copy(data[1:5], h264Magic[:])
	binary.BigEndian.PutUint64(data[5:13], metadata.Sequence)
	binary.BigEndian.PutUint64(data[13:21], uint64(metadata.CaptureTimestamp.UnixMicro()))
	binary.BigEndian.PutUint32(data[21:25], metadata.Flags)
	binary.BigEndian.PutUint32(data[25:29], uint32(len(annexB)))
	copy(data[29:], annexB)
	return data, nil
}
func parseH264AccessUnitPacket(data []byte) (H264AccessUnitMetadata, []byte, error) {
	if len(data) < 1+h264HeaderSize || data[0] != PacketH264AccessUnit || string(data[1:5]) != string(h264Magic[:]) {
		return H264AccessUnitMetadata{}, nil, fmt.Errorf("invalid H.264 access unit")
	}
	payload := data[1:]
	size := binary.BigEndian.Uint32(payload[24:28])
	if int(size) != len(payload[28:]) || size == 0 {
		return H264AccessUnitMetadata{}, nil, fmt.Errorf("invalid H.264 access unit length")
	}
	captured := int64(binary.BigEndian.Uint64(payload[12:20]))
	if captured <= 0 {
		return H264AccessUnitMetadata{}, nil, fmt.Errorf("invalid H.264 capture timestamp")
	}
	return H264AccessUnitMetadata{Sequence: binary.BigEndian.Uint64(payload[4:12]), CaptureTimestamp: time.UnixMicro(captured), Flags: binary.BigEndian.Uint32(payload[20:24])}, payload[28:], nil
}
func ParseH264AccessUnitPacket(data []byte) (H264AccessUnitMetadata, []byte, error) {
	return parseH264AccessUnitPacket(data)
}
func videoControlPacket(kind byte, value any) ([]byte, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return packet(kind, data)
}
func parseVideoCapabilities(data []byte) (VideoCapabilities, error) {
	var value VideoCapabilities
	if err := parseVideoControl(PacketVideoCapabilities, data, &value); err != nil {
		return value, err
	}
	if value.Version != videoProtocolVersion || !validCodecs(value.Codecs) {
		return value, fmt.Errorf("invalid video capabilities")
	}
	return value, nil
}
func parseKeyframeRequest(data []byte) (KeyframeRequest, error) {
	var value KeyframeRequest
	if err := parseVideoControl(PacketVideoKeyframe, data, &value); err != nil {
		return value, err
	}
	if len(value.Reason) == 0 || len(value.Reason) > 128 {
		return value, fmt.Errorf("invalid keyframe request")
	}
	return value, nil
}
func parseVideoControl(kind byte, data []byte, destination any) error {
	if len(data) < 2 || data[0] != kind || len(data) > 2048 || json.Unmarshal(data[1:], destination) != nil {
		return fmt.Errorf("invalid video control")
	}
	return nil
}
func validCodecs(codecs []string) bool {
	for _, codec := range codecs {
		if codec == "jpeg" || codec == "h264" {
			return true
		}
	}
	return false
}
func selectVideo(capabilities VideoCapabilities, width, height int) VideoSelected {
	codec := "jpeg"
	format := "jpeg"
	for _, candidate := range capabilities.Codecs {
		if candidate == "h264" {
			codec, format = "h264", "annexb"
			break
		}
	}
	return VideoSelected{Version: videoProtocolVersion, Codec: codec, Width: width, Height: height, FPS: 30, Format: format}
}
func infoPacket(info ScreenInfo) ([]byte, error) {
	if info.Width < 1 || info.Height < 1 || info.Width > 16384 || info.Height > 16384 {
		return nil, fmt.Errorf("invalid screen dimensions")
	}
	data, err := json.Marshal(info)
	if err != nil {
		return nil, err
	}
	return packet(PacketInfo, data)
}
func validMouseCoordinates(input Input) bool {
	return input.X >= 0 && input.Y >= 0 && input.X <= 16384 && input.Y <= 16384
}
func parseInput(data []byte) (Input, error) {
	var input Input
	if len(data) < 2 || len(data) > 1024 || data[0] != PacketInput || json.Unmarshal(data[1:], &input) != nil {
		return Input{}, fmt.Errorf("invalid remote input")
	}
	switch input.Type {
	case "mouse_move":
		if !validMouseCoordinates(input) {
			return Input{}, fmt.Errorf("invalid mouse coordinates")
		}
	case "mouse_down", "mouse_up":
		if !validMouseCoordinates(input) || (input.Button != "left" && input.Button != "right" && input.Button != "middle") {
			return Input{}, fmt.Errorf("invalid mouse button")
		}
	case "mouse_wheel":
		if input.Delta < -12000 || input.Delta > 12000 || input.Delta == 0 {
			return Input{}, fmt.Errorf("invalid mouse wheel")
		}
	case "key_down", "key_up":
		if input.VK == 0 {
			return Input{}, fmt.Errorf("invalid virtual key")
		}
	default:
		return Input{}, fmt.Errorf("unsupported remote input")
	}
	return input, nil
}
