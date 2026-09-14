package rdp

import (
	"encoding/json"
	"fmt"
)

const (
	PacketFrame     byte = 1
	PacketInput     byte = 2
	PacketInfo      byte = 3
	maxRemotePacket      = 2 * 1024 * 1024
)

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
