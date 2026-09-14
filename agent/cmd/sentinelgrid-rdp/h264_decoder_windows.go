//go:build windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

type nativeDecodedFrame struct {
	Sequence, DecodeMilliseconds       uint64
	Width, Height, Stride, PayloadSize uint32
}

type nativeDecoderStats struct {
	SubmittedAccessUnits, DecodedFrames, Bytes, Failures     uint64
	ProcessInputNotAccepting, ProcessOutputOK, NeedMoreInput uint64
	StreamChanges, DiscardedOutputFrames                     uint64
	Width, Height                                            uint32
}

type nativeDecoderInfo struct {
	Name                 [256]byte
	Hardware, OutputMode uint32
}

type nativeH264Decoder struct {
	mu                                 sync.Mutex
	dll                                *windows.DLL
	destroy, decode, stats, info, last *windows.Proc
	lastStage                          *windows.Proc
	handle                             uintptr
	width, height                      int
	lastStatsLog                       time.Time
}

func newNativeH264Decoder(width, height int) (*nativeH264Decoder, error) {
	if width < 2 || height < 2 || width%2 != 0 || height%2 != 0 {
		return nil, fmt.Errorf("invalid H.264 decoder dimensions %dx%d", width, height)
	}
	executable, err := os.Executable()
	if err != nil {
		return nil, fmt.Errorf("decoder executable path: %w", err)
	}
	dll, err := windows.LoadDLL(filepath.Join(filepath.Dir(executable), "SentinelGridVideo.dll"))
	if err != nil {
		return nil, fmt.Errorf("decoder DLL load: %w", err)
	}
	find := func(name string) (*windows.Proc, error) {
		proc, findErr := dll.FindProc(name)
		if findErr != nil {
			_ = dll.Release()
			return nil, fmt.Errorf("decoder ABI %s: %w", name, findErr)
		}
		return proc, nil
	}
	create, err := find("SGVideo_CreateH264Decoder")
	if err != nil {
		return nil, err
	}
	destroy, err := find("SGVideo_DestroyH264Decoder")
	if err != nil {
		return nil, err
	}
	decode, err := find("SGVideo_DecodeH264ToBGRA")
	if err != nil {
		return nil, err
	}
	stats, err := find("SGVideo_GetH264DecoderStats")
	if err != nil {
		return nil, err
	}
	info, err := find("SGVideo_GetH264DecoderInfo")
	if err != nil {
		return nil, err
	}
	last, err := find("SGVideo_GetH264DecoderLastError")
	if err != nil {
		return nil, err
	}
	lastStage, err := find("SGVideo_GetH264DecoderLastErrorStage")
	if err != nil {
		return nil, err
	}
	decoder := &nativeH264Decoder{dll: dll, destroy: destroy, decode: decode, stats: stats, info: info, last: last, lastStage: lastStage, width: width, height: height}
	result, _, _ := create.Call(uintptr(width), uintptr(height), 30, uintptr(unsafe.Pointer(&decoder.handle)))
	if err := nativeRendererHRESULT(result); err != nil {
		_ = dll.Release()
		return nil, fmt.Errorf("decoder create: %w", err)
	}
	return decoder, nil
}

func (d *nativeH264Decoder) decodeAU(payload []byte, sequence uint64) (viewerFrame, bool, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.handle == 0 || len(payload) == 0 {
		return viewerFrame{}, false, fmt.Errorf("decoder closed or empty access unit")
	}
	pixels := make([]byte, d.width*d.height*4)
	var decoded nativeDecodedFrame
	result, _, _ := d.decode.Call(d.handle, uintptr(unsafe.Pointer(&payload[0])), uintptr(len(payload)), uintptr(sequence), uintptr(unsafe.Pointer(&pixels[0])), uintptr(len(pixels)), uintptr(unsafe.Pointer(&decoded)))
	if result == 1 {
		return viewerFrame{}, false, nil
	}
	if err := nativeRendererHRESULT(result); err != nil {
		return viewerFrame{}, false, fmt.Errorf("stage=%s hr=0x%08x: %w", d.lastErrorStageLocked(), uint32(result), err)
	}
	if decoded.Width == 0 || decoded.Height == 0 || decoded.Width > uint32(d.width) || decoded.Height > uint32(d.height) || decoded.Stride < decoded.Width*4 {
		return viewerFrame{}, false, fmt.Errorf("decoder returned invalid frame metadata")
	}
	return viewerFrame{pixels: pixels, width: int(decoded.Width), height: int(decoded.Height), stride: int(decoded.Stride)}, true, nil
}

func (d *nativeH264Decoder) logStats(logger *viewerLogger, ausReceived uint64) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.handle == 0 || time.Since(d.lastStatsLog) < 3*time.Second {
		return
	}
	var stats nativeDecoderStats
	result, _, _ := d.stats.Call(d.handle, uintptr(unsafe.Pointer(&stats)))
	if nativeRendererHRESULT(result) != nil {
		return
	}
	d.lastStatsLog = time.Now()
	logger.event(fmt.Sprintf("VIEWER_H264_STATS aus_received=%d aus_submitted=%d decoded_frames=%d need_more_input=%d not_accepting=%d stream_changes=%d", ausReceived, stats.SubmittedAccessUnits, stats.DecodedFrames, stats.NeedMoreInput, stats.ProcessInputNotAccepting, stats.StreamChanges))
}

func (d *nativeH264Decoder) lastErrorStageLocked() string {
	var stage [64]byte
	result, _, _ := d.lastStage.Call(d.handle, uintptr(unsafe.Pointer(&stage[0])), uintptr(len(stage)))
	if nativeRendererHRESULT(result) != nil {
		return "unknown"
	}
	for i, b := range stage {
		if b == 0 {
			return string(stage[:i])
		}
	}
	return string(stage[:])
}

func (d *nativeH264Decoder) description() (string, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	var info nativeDecoderInfo
	if d.handle == 0 {
		return "", false
	}
	if result, _, _ := d.info.Call(d.handle, uintptr(unsafe.Pointer(&info))); nativeRendererHRESULT(result) != nil {
		return "", false
	}
	name := string(info.Name[:])
	for i, b := range name {
		if b == 0 {
			name = name[:i]
			break
		}
	}
	return name, info.Hardware != 0
}

func (d *nativeH264Decoder) close() {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.handle != 0 {
		d.destroy.Call(d.handle)
		d.handle = 0
	}
	if d.dll != nil {
		_ = d.dll.Release()
		d.dll = nil
	}
}
