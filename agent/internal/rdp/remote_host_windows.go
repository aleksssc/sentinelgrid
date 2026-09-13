//go:build windows

package rdp

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/jpeg"
	"os"
	"strings"
	"time"
	"unsafe"

	"github.com/gorilla/websocket"
	"golang.org/x/sys/windows"
)

const createUnicodeEnvironment = 0x00000400

func LaunchInteractive(ctx context.Context, connection Connection) error {
	session := windows.WTSGetActiveConsoleSessionId()
	if session == 0xffffffff {
		return fmt.Errorf("no active interactive Windows session")
	}
	var token windows.Token
	if err := windows.WTSQueryUserToken(session, &token); err != nil {
		return fmt.Errorf("interactive user token unavailable: %w", err)
	}
	defer token.Close()
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	app, err := windows.UTF16PtrFromString(exe)
	if err != nil {
		return err
	}
	line, err := windows.UTF16FromString(`"` + exe + `" -remote-host`)
	if err != nil {
		return err
	}
	desktop, err := windows.UTF16PtrFromString(`winsta0\default`)
	if err != nil {
		return err
	}
	env, err := remoteEnvironment(connection)
	if err != nil {
		return err
	}
	startup := windows.StartupInfo{Cb: uint32(unsafe.Sizeof(windows.StartupInfo{})), Desktop: desktop}
	var process windows.ProcessInformation
	if err := windows.CreateProcessAsUser(token, app, &line[0], nil, nil, false, windows.CREATE_NO_WINDOW|createUnicodeEnvironment, &env[0], nil, &startup, &process); err != nil {
		return fmt.Errorf("could not start remote host in interactive session: %w", err)
	}
	defer windows.CloseHandle(process.Process)
	defer windows.CloseHandle(process.Thread)
	stop := context.AfterFunc(ctx, func() { _ = windows.TerminateProcess(process.Process, 1) })
	defer stop()
	for {
		state, err := windows.WaitForSingleObject(process.Process, 250)
		if err != nil {
			return err
		}
		if state == windows.WAIT_OBJECT_0 {
			var code uint32
			if err := windows.GetExitCodeProcess(process.Process, &code); err != nil {
				return err
			}
			if code != 0 {
				return fmt.Errorf("remote host exited with code %d", code)
			}
			return nil
		}
		if err := ctx.Err(); err != nil {
			return err
		}
	}
}

func remoteEnvironment(c Connection) ([]uint16, error) {
	values := make([]string, 0, len(os.Environ())+3)
	for _, value := range os.Environ() {
		if !strings.HasPrefix(value, "SENTINELGRID_REMOTE_") {
			values = append(values, value)
		}
	}
	values = append(values, "SENTINELGRID_REMOTE_RELAY="+c.Relay, "SENTINELGRID_REMOTE_TICKET="+c.Ticket, "SENTINELGRID_REMOTE_EXPIRES="+c.ExpiresAt.UTC().Format(time.RFC3339Nano))
	return windows.UTF16FromString(strings.Join(values, "\x00") + "\x00")
}

func RunRemoteHost(ctx context.Context) error {
	connection := Connection{Relay: os.Getenv("SENTINELGRID_REMOTE_RELAY"), Ticket: os.Getenv("SENTINELGRID_REMOTE_TICKET")}
	if value, err := time.Parse(time.RFC3339Nano, os.Getenv("SENTINELGRID_REMOTE_EXPIRES")); err == nil {
		connection.ExpiresAt = value
	}
	if err := connection.Validate(); err != nil {
		return err
	}
	ws, err := Dial(ctx, connection)
	if err != nil {
		return err
	}
	defer ws.Close()
	if err := sendScreenInfo(ws); err != nil {
		return err
	}
	inputDone := make(chan error, 1)
	go readRemoteInput(ctx, ws, inputDone)
	ticker := time.NewTicker(125 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case err := <-inputDone:
			if err != nil && ctx.Err() == nil {
				return err
			}
			return nil
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			jpg, err := capturePrimaryJPEG()
			if err != nil {
				return err
			}
			data, err := packet(PacketFrame, jpg)
			if err != nil {
				return err
			}
			if err := writePacket(ws, data); err != nil {
				return err
			}
		}
	}
}

func sendScreenInfo(ws *websocket.Conn) error {
	width, height := screenSize()
	data, err := infoPacket(ScreenInfo{Type: "screen_info", Width: width, Height: height})
	if err != nil {
		return err
	}
	return writePacket(ws, data)
}
func readRemoteInput(ctx context.Context, ws *websocket.Conn, done chan<- error) {
	for {
		kind, data, err := ws.ReadMessage()
		if err != nil {
			done <- err
			return
		}
		if kind != websocket.BinaryMessage {
			done <- fmt.Errorf("non-binary remote input")
			return
		}
		input, err := parseInput(data)
		if err != nil {
			done <- err
			return
		}
		if err = injectInput(input); err != nil {
			done <- err
			return
		}
		if ctx.Err() != nil {
			done <- nil
			return
		}
	}
}

var user32 = windows.NewLazySystemDLL("user32.dll")
var gdi32 = windows.NewLazySystemDLL("gdi32.dll")
var getDC = user32.NewProc("GetDC")
var releaseDC = user32.NewProc("ReleaseDC")
var getSystemMetrics = user32.NewProc("GetSystemMetrics")
var sendInput = user32.NewProc("SendInput")
var createCompatibleDC = gdi32.NewProc("CreateCompatibleDC")
var createCompatibleBitmap = gdi32.NewProc("CreateCompatibleBitmap")
var selectObject = gdi32.NewProc("SelectObject")
var deleteObject = gdi32.NewProc("DeleteObject")
var deleteDC = gdi32.NewProc("DeleteDC")
var bitBlt = gdi32.NewProc("BitBlt")
var getDIBits = gdi32.NewProc("GetDIBits")

type bitmapInfoHeader struct {
	Size                         uint32
	Width, Height                int32
	Planes, BitCount             uint16
	Compression, SizeImage       uint32
	XPelsPerMeter, YPelsPerMeter int32
	ClrUsed, ClrImportant        uint32
}
type bitmapInfo struct {
	Header bitmapInfoHeader
	Colors [1]uint32
}

func screenSize() (int, int) {
	w, _, _ := getSystemMetrics.Call(0)
	h, _, _ := getSystemMetrics.Call(1)
	return int(w), int(h)
}
func capturePrimaryJPEG() ([]byte, error) {
	width, height := screenSize()
	if width < 1 || height < 1 {
		return nil, fmt.Errorf("primary display unavailable")
	}
	dc, _, _ := getDC.Call(0)
	if dc == 0 {
		return nil, fmt.Errorf("desktop capture unavailable")
	}
	defer releaseDC.Call(0, dc)
	memory, _, _ := createCompatibleDC.Call(dc)
	if memory == 0 {
		return nil, fmt.Errorf("desktop capture unavailable")
	}
	defer deleteDC.Call(memory)
	bitmap, _, _ := createCompatibleBitmap.Call(dc, uintptr(width), uintptr(height))
	if bitmap == 0 {
		return nil, fmt.Errorf("desktop capture unavailable")
	}
	defer deleteObject.Call(bitmap)
	old, _, _ := selectObject.Call(memory, bitmap)
	defer selectObject.Call(memory, old)
	if ok, _, _ := bitBlt.Call(memory, 0, 0, uintptr(width), uintptr(height), dc, 0, 0, 0x00CC0020); ok == 0 {
		return nil, fmt.Errorf("desktop capture failed")
	}
	pixels := make([]byte, width*height*4)
	info := bitmapInfo{Header: bitmapInfoHeader{Size: uint32(unsafe.Sizeof(bitmapInfoHeader{})), Width: int32(width), Height: -int32(height), Planes: 1, BitCount: 32}}
	if lines, _, _ := getDIBits.Call(memory, bitmap, 0, uintptr(height), uintptr(unsafe.Pointer(&pixels[0])), uintptr(unsafe.Pointer(&info)), 0); lines != uintptr(height) {
		return nil, fmt.Errorf("desktop pixels unavailable")
	}
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for i := 0; i < len(pixels); i += 4 {
		img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = pixels[i+2], pixels[i+1], pixels[i], 0xff
	}
	var out bytes.Buffer
	if err := jpeg.Encode(&out, img, &jpeg.Options{Quality: 65}); err != nil {
		return nil, err
	}
	if out.Len() > maxRemotePacket-1 {
		return nil, fmt.Errorf("captured frame exceeds limit")
	}
	return out.Bytes(), nil
}

type mouseInput struct {
	DX, DY                 int32
	MouseData, Flags, Time uint32
	ExtraInfo              uintptr
}
type keyInput struct {
	VK, Scan    uint16
	Flags, Time uint32
	ExtraInfo   uintptr
}
type inputUnion struct {
	Mouse mouseInput
	Pad   [8]byte
}
type inputRecord struct {
	Type uint32
	Pad  uint32
	Data inputUnion
}

func injectInput(input Input) error {
	var record inputRecord
	switch input.Type {
	case "mouse_move":
		w, h := screenSize()
		record.Data.Mouse.DX = int32(input.X * 65535 / max(1, w-1))
		record.Data.Mouse.DY = int32(input.Y * 65535 / max(1, h-1))
		record.Data.Mouse.Flags = 0x8001
	case "mouse_wheel":
		record.Data.Mouse.MouseData = uint32(int32(input.Delta))
		record.Data.Mouse.Flags = 0x0800
	case "mouse_down", "mouse_up":
		flags := map[string]uint32{"left": 0x0002, "right": 0x0008, "middle": 0x0020}
		if input.Type == "mouse_up" {
			flags = map[string]uint32{"left": 0x0004, "right": 0x0010, "middle": 0x0040}
		}
		record.Data.Mouse.Flags = flags[input.Button]
	case "key_down", "key_up":
		record.Type = 1
		*(*keyInput)(unsafe.Pointer(&record.Data)) = keyInput{VK: input.VK}
		if input.Type == "key_up" {
			(*keyInput)(unsafe.Pointer(&record.Data)).Flags = 0x0002
		}
	default:
		return fmt.Errorf("unsupported remote input")
	}
	if count, _, err := sendInput.Call(1, uintptr(unsafe.Pointer(&record)), unsafe.Sizeof(record)); count != 1 {
		return fmt.Errorf("Windows rejected remote input: %v", err)
	}
	return nil
}
