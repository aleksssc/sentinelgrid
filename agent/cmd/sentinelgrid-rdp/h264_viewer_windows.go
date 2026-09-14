//go:build windows

package main

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/gorilla/websocket"
	"sentinelgrid/agent/internal/rdp"
)

func (v *viewer) configureVideoCapabilities(width, height int) {
	v.mu.RLock()
	if v.videoCodec != "" || v.ws == nil || v.renderer == nil {
		v.mu.RUnlock()
		return
	}
	v.mu.RUnlock()
	decoder, err := newNativeH264Decoder(width, height)
	codecs := []string{"jpeg"}
	if err == nil {
		codecs = []string{"h264", "jpeg"}
	}
	v.mu.Lock()
	if v.videoCodec != "" || v.ws == nil {
		v.mu.Unlock()
		if decoder != nil {
			decoder.close()
		}
		return
	}
	if decoder != nil {
		v.decoder = decoder
		name, hardware := decoder.description()
		v.logger.event(fmt.Sprintf("VIEWER_DECODER backend=media_foundation hardware=%t name=%q", hardware, name))
		v.logger.event("VIEWER_DECODER_OUTPUT mode=cpu_fallback reason=nv12_to_bgra")
	} else {
		v.logger.event("VIEWER_VIDEO_CAPABILITIES h264=false jpeg=true reason=decoder_initialization_failed")
	}
	ws := v.ws
	v.mu.Unlock()
	if decoder != nil {
		v.logger.event("VIEWER_VIDEO_CAPABILITIES h264=true jpeg=true")
	}
	packet, packetErr := json.Marshal(rdp.VideoCapabilities{Version: 1, Codecs: codecs, Renderer: []string{"d3d11"}})
	if packetErr != nil {
		return
	}
	v.writeMu.Lock()
	defer v.writeMu.Unlock()
	if err := ws.WriteMessage(websocket.BinaryMessage, append([]byte{rdp.PacketVideoCapabilities}, packet...)); err != nil {
		v.logger.event("VIEWER_VIDEO_CAPABILITIES_SEND_FAILED")
	}
}

func (v *viewer) handleVideoSelected(data []byte) {
	var selected rdp.VideoSelected
	if len(data) < 2 || json.Unmarshal(data[1:], &selected) != nil || selected.Version != 1 {
		v.logger.event("VIEWER_VIDEO_SELECTION_INVALID")
		return
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if selected.Codec == "h264" && selected.Format == "annexb" && v.decoder != nil {
		v.videoCodec = "h264"
		v.logger.event("VIEWER_VIDEO_SELECTED codec=h264 format=annexb")
		return
	}
	if selected.Codec == "jpeg" && selected.Format == "jpeg" {
		if v.decoder != nil {
			v.decoder.close()
			v.decoder = nil
		}
		v.videoCodec = "jpeg"
		v.logger.event("VIEWER_VIDEO_SELECTED codec=jpeg format=jpeg")
		return
	}
	v.logger.event("VIEWER_VIDEO_SELECTION_UNSUPPORTED")
}

func (v *viewer) handleH264AccessUnit(data []byte) {
	metadata, annexB, err := rdp.ParseH264AccessUnitPacket(data)
	if err != nil {
		v.logger.event("VIEWER_H264_AU_INVALID")
		v.requestH264Keyframe("invalid_access_unit")
		return
	}
	v.mu.RLock()
	decoder, codec, closed := v.decoder, v.videoCodec, v.sessionClosed
	v.mu.RUnlock()
	if closed || codec != "h264" || decoder == nil {
		v.logger.event("VIEWER_H264_AU_UNEXPECTED")
		return
	}
	started := time.Now()
	frame, decoded, err := decoder.decodeAU(annexB, metadata.Sequence)
	if err != nil {
		v.logger.event("VIEWER_H264_DECODE_FAILED " + err.Error())
		v.requestH264Keyframe("decode_failure")
		return
	}
	v.mu.Lock()
	v.socketReceived++
	v.frameBytes += uint64(len(annexB))
	ausReceived := v.socketReceived
	if decoded && !v.sessionClosed {
		v.frame = frame
		v.frameGeneration++
		v.decodedCompleted++
		v.decodeMetrics.add(time.Since(started))
		hwnd := v.hwnd
		notify := hwnd != 0 && v.notification.schedule()
		v.mu.Unlock()
		decoder.logStats(v.logger, ausReceived)
		if notify {
			v.postFrameReady(hwnd)
		}
		return
	}
	v.mu.Unlock()
	decoder.logStats(v.logger, ausReceived)
}

func (v *viewer) requestH264Keyframe(reason string) {
	v.mu.Lock()
	if v.ws == nil || v.sessionClosed || v.videoCodec != "h264" || time.Since(v.lastKeyframeRequest) < time.Second {
		v.mu.Unlock()
		return
	}
	v.lastKeyframeRequest = time.Now()
	ws := v.ws
	v.mu.Unlock()
	payload, err := json.Marshal(rdp.KeyframeRequest{Reason: reason})
	if err != nil {
		return
	}
	v.writeMu.Lock()
	err = ws.WriteMessage(websocket.BinaryMessage, append([]byte{rdp.PacketVideoKeyframe}, payload...))
	v.writeMu.Unlock()
	if err != nil {
		v.logger.event("VIEWER_KEYFRAME_REQUEST_SEND_FAILED")
		return
	}
	v.logger.event("VIEWER_KEYFRAME_REQUEST reason=" + reason)
}
