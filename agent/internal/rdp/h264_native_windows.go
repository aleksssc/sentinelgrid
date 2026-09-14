//go:build windows

package rdp

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

type nativeH264Frame struct {
	Sequence, CaptureMicroseconds, EncodeMicroseconds uint64
	PayloadSize, Flags                                uint32
}

type nativeH264Stats struct {
	EncodedFrames, Keyframes, ForcedKeyframes, Bytes, Failures uint64
	Width, Height, Bitrate, FPS                                uint32
}

type nativeH264Info struct {
	Name                                        [256]byte
	Hardware, ForceKeyframeSupported, InputMode uint32
}

type nativeH264Encoder struct {
	dll                                       *windows.DLL
	destroy, encode, force, stats, last, info *windows.Proc
	handle                                    uintptr
	mu                                        sync.Mutex
}

func newNativeH264Encoder(width, height, fps, bitrate int) (*nativeH264Encoder, error) {
	executable, err := os.Executable()
	if err != nil {
		return nil, fmt.Errorf("native H.264 executable path: %w", err)
	}
	dll, err := windows.LoadDLL(filepath.Join(filepath.Dir(executable), nativeVideoDLLName))
	if err != nil {
		return nil, fmt.Errorf("native H.264 DLL load: %w", err)
	}
	find := func(name string) (*windows.Proc, error) {
		proc, findErr := dll.FindProc(name)
		if findErr != nil {
			_ = dll.Release()
			return nil, fmt.Errorf("native H.264 API %s: %w", name, findErr)
		}
		return proc, nil
	}
	create, err := find("SGVideo_CreateH264Encoder")
	if err != nil {
		return nil, err
	}
	destroy, err := find("SGVideo_DestroyH264Encoder")
	if err != nil {
		return nil, err
	}
	encode, err := find("SGVideo_EncodeBGRAToH264")
	if err != nil {
		return nil, err
	}
	force, err := find("SGVideo_ForceH264Keyframe")
	if err != nil {
		return nil, err
	}
	stats, err := find("SGVideo_GetH264EncoderStats")
	if err != nil {
		return nil, err
	}
	last, err := find("SGVideo_GetH264EncoderLastError")
	if err != nil {
		return nil, err
	}
	info, err := find("SGVideo_GetH264EncoderInfo")
	if err != nil {
		return nil, err
	}
	encoder := &nativeH264Encoder{dll: dll, destroy: destroy, encode: encode, force: force, stats: stats, last: last, info: info}
	result, _, _ := create.Call(uintptr(width), uintptr(height), uintptr(fps), uintptr(bitrate), uintptr(unsafe.Pointer(&encoder.handle)))
	if err := nativeHRESULT(result); err != nil {
		_ = dll.Release()
		return nil, fmt.Errorf("native H.264 create: %w", err)
	}
	return encoder, nil
}
func (e *nativeH264Encoder) Close() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.handle != 0 {
		e.destroy.Call(e.handle)
		e.handle = 0
	}
	if e.dll != nil {
		err := e.dll.Release()
		e.dll = nil
		return err
	}
	return nil
}
func (e *nativeH264Encoder) Encode(frame captureFrame, sequence uint64, captured uint64) ([]byte, nativeH264Frame, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.handle == 0 || len(frame.BGRA) == 0 {
		return nil, nativeH264Frame{}, fmt.Errorf("native H.264 encoder is closed")
	}
	output := make([]byte, maxRemotePacket-1-h264HeaderSize)
	var encoded nativeH264Frame
	result, _, _ := e.encode.Call(e.handle, uintptr(unsafe.Pointer(&frame.BGRA[0])), uintptr(frame.Stride), uintptr(sequence), uintptr(captured), uintptr(unsafe.Pointer(&output[0])), uintptr(len(output)), uintptr(unsafe.Pointer(&encoded)))
	if result == 1 {
		return nil, encoded, nil
	}
	if err := nativeHRESULT(result); err != nil {
		return nil, encoded, fmt.Errorf("native H.264 encode: %w", err)
	}
	return output[:encoded.PayloadSize], encoded, nil
}
func (e *nativeH264Encoder) ForceKeyframe() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	result, _, _ := e.force.Call(e.handle)
	if err := nativeHRESULT(result); err != nil {
		return err
	}
	return nil
}
func (e *nativeH264Encoder) Stats() (nativeH264Stats, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	var stats nativeH264Stats
	result, _, _ := e.stats.Call(e.handle, uintptr(unsafe.Pointer(&stats)))
	return stats, nativeHRESULT(result)
}
func (e *nativeH264Encoder) Info() (nativeH264Info, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	var info nativeH264Info
	result, _, _ := e.info.Call(e.handle, uintptr(unsafe.Pointer(&info)))
	return info, nativeHRESULT(result)
}
