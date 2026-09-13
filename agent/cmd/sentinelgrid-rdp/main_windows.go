//go:build windows

package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"github.com/gorilla/websocket"
	buildinfo "sentinelgrid/agent"
	"sentinelgrid/agent/internal/rdp"
)

const (
	wmDestroy          = 0x0002
	wmPaint            = 0x000f
	wmSize             = 0x0005
	wmSetFocus         = 0x0007
	wmMouseMove        = 0x0200
	wmLButtonDown      = 0x0201
	wmLButtonUp        = 0x0202
	wmRButtonDown      = 0x0204
	wmRButtonUp        = 0x0205
	wmMButtonDown      = 0x0207
	wmMButtonUp        = 0x0208
	wmMouseWheel       = 0x020a
	wmKeyDown          = 0x0100
	wmKeyUp            = 0x0101
	wsOverlappedWindow = 0x00cf0000
	swShow             = 5
	biRGB              = 0
)

type viewer struct {
	ws            *websocket.Conn
	mu            sync.RWMutex
	image         *image.RGBA
	width, height int
	hwnd          uintptr
}

var activeViewer *viewer
var viewerUser32 = syscall.NewLazyDLL("user32.dll")
var viewerGDI32 = syscall.NewLazyDLL("gdi32.dll")
var registerClassEx = viewerUser32.NewProc("RegisterClassExW")
var createWindowEx = viewerUser32.NewProc("CreateWindowExW")
var defWindowProc = viewerUser32.NewProc("DefWindowProcW")
var getMessage = viewerUser32.NewProc("GetMessageW")
var translateMessage = viewerUser32.NewProc("TranslateMessage")
var dispatchMessage = viewerUser32.NewProc("DispatchMessageW")
var postQuitMessage = viewerUser32.NewProc("PostQuitMessage")
var beginPaint = viewerUser32.NewProc("BeginPaint")
var endPaint = viewerUser32.NewProc("EndPaint")
var invalidateRect = viewerUser32.NewProc("InvalidateRect")
var getClientRect = viewerUser32.NewProc("GetClientRect")
var setFocus = viewerUser32.NewProc("SetFocus")
var stretchDIBits = viewerGDI32.NewProc("StretchDIBits")

type point struct{ X, Y int32 }
type rect struct{ Left, Top, Right, Bottom int32 }
type msg struct {
	Hwnd           uintptr
	Message        uint32
	WParam, LParam uintptr
	Time           uint32
	Pt             point
}
type paintStruct struct {
	HDC                uintptr
	Erase              int32
	Paint              rect
	Restore, IncUpdate int32
	RGB                [32]byte
}
type wndClassEx struct {
	Size                               uint32
	Style                              uint32
	WndProc                            uintptr
	ClsExtra, WndExtra                 int32
	Instance, Icon, Cursor, Background uintptr
	MenuName, ClassName                *uint16
	IconSmall                          uintptr
}
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

func run(path string) error {
	if !filepath.IsAbs(path) && filepath.Ext(path) != ".sgrdp" {
		return fmt.Errorf("select a SentinelGrid .sgrdp connection file")
	}
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("connection file could not be opened")
	}
	data, readErr := io.ReadAll(io.LimitReader(file, 2049))
	file.Close()
	if readErr != nil || len(data) > 2048 {
		return fmt.Errorf("invalid connection file")
	}
	var connection rdp.Connection
	if json.Unmarshal(data, &connection) != nil || connection.Version != 1 || connection.Validate() != nil || connection.ExpiresAt.After(time.Now().Add(61*time.Second)) {
		return fmt.Errorf("invalid or expired connection file; request a new session in Device View")
	}
	if err := os.Remove(path); err != nil {
		return fmt.Errorf("could not remove consumed one-time connection file")
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	ws, err := rdp.Dial(ctx, connection)
	if err != nil {
		return err
	}
	defer ws.Close()
	v := &viewer{ws: ws}
	activeViewer = v
	go v.receive()
	return v.window()
}
func (v *viewer) receive() {
	for {
		kind, data, err := v.ws.ReadMessage()
		if err != nil {
			if v.hwnd != 0 {
				postQuitMessage.Call(0)
			}
			return
		}
		if kind != websocket.BinaryMessage || len(data) < 2 {
			continue
		}
		switch data[0] {
		case rdp.PacketInfo:
			var info rdp.ScreenInfo
			if json.Unmarshal(data[1:], &info) == nil {
				v.mu.Lock()
				v.width, v.height = info.Width, info.Height
				v.mu.Unlock()
			}
		case rdp.PacketFrame:
			decoded, err := jpeg.Decode(bytesReader(data[1:]))
			if err != nil {
				continue
			}
			rgba := toRGBA(decoded)
			v.mu.Lock()
			v.image = rgba
			v.width, v.height = rgba.Bounds().Dx(), rgba.Bounds().Dy()
			v.mu.Unlock()
			if v.hwnd != 0 {
				invalidateRect.Call(v.hwnd, 0, 0)
			}
		}
	}
}

type byteReader []byte

func bytesReader(data []byte) *byteReader { value := byteReader(data); return &value }
func (r *byteReader) Read(p []byte) (int, error) {
	if len(*r) == 0 {
		return 0, io.EOF
	}
	n := copy(p, *r)
	*r = (*r)[n:]
	return n, nil
}
func toRGBA(source image.Image) *image.RGBA {
	bounds := source.Bounds()
	value := image.NewRGBA(bounds)
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			value.Set(x, y, source.At(x, y))
		}
	}
	return value
}
func (v *viewer) send(input rdp.Input) {
	data, err := json.Marshal(input)
	if err != nil {
		return
	}
	packet := append([]byte{rdp.PacketInput}, data...)
	_ = v.ws.WriteMessage(websocket.BinaryMessage, packet)
}
func (v *viewer) window() error {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	instance := uintptr(0)
	class, _ := syscall.UTF16PtrFromString("SentinelGridRemoteViewer")
	title, _ := syscall.UTF16PtrFromString("SentinelGrid Remote")
	callback := syscall.NewCallback(viewerProc)
	wc := wndClassEx{Size: uint32(unsafe.Sizeof(wndClassEx{})), WndProc: callback, Instance: instance, ClassName: class}
	if atom, _, err := registerClassEx.Call(uintptr(unsafe.Pointer(&wc))); atom == 0 {
		return fmt.Errorf("could not register viewer window: %v", err)
	}
	hwnd, _, err := createWindowEx.Call(0, uintptr(unsafe.Pointer(class)), uintptr(unsafe.Pointer(title)), wsOverlappedWindow, 100, 100, 1280, 800, 0, 0, instance, 0)
	if hwnd == 0 {
		return fmt.Errorf("could not create viewer window: %v", err)
	}
	v.hwnd = hwnd
	viewerUser32.NewProc("ShowWindow").Call(hwnd, swShow)
	viewerUser32.NewProc("UpdateWindow").Call(hwnd)
	var message msg
	for {
		result, _, err := getMessage.Call(uintptr(unsafe.Pointer(&message)), 0, 0, 0)
		if int32(result) <= 0 {
			if result == ^uintptr(0) {
				return fmt.Errorf("viewer message error: %v", err)
			}
			return nil
		}
		translateMessage.Call(uintptr(unsafe.Pointer(&message)))
		dispatchMessage.Call(uintptr(unsafe.Pointer(&message)))
	}
}
func viewerProc(hwnd uintptr, message uint32, wparam, lparam uintptr) uintptr {
	v := activeViewer
	if v == nil {
		value, _, _ := defWindowProc.Call(hwnd, uintptr(message), wparam, lparam)
		return value
	}
	switch message {
	case wmDestroy:
		postQuitMessage.Call(0)
		return 0
	case wmSetFocus:
		setFocus.Call(hwnd)
	case wmPaint:
		v.paint(hwnd)
		return 0
	case wmMouseMove:
		x, y := v.mapMouse(hwnd, int(int16(lparam)), int(int16(lparam>>16)))
		v.send(rdp.Input{Type: "mouse_move", X: x, Y: y})
	case wmLButtonDown:
		v.send(rdp.Input{Type: "mouse_down", Button: "left"})
	case wmLButtonUp:
		v.send(rdp.Input{Type: "mouse_up", Button: "left"})
	case wmRButtonDown:
		v.send(rdp.Input{Type: "mouse_down", Button: "right"})
	case wmRButtonUp:
		v.send(rdp.Input{Type: "mouse_up", Button: "right"})
	case wmMButtonDown:
		v.send(rdp.Input{Type: "mouse_down", Button: "middle"})
	case wmMButtonUp:
		v.send(rdp.Input{Type: "mouse_up", Button: "middle"})
	case wmMouseWheel:
		v.send(rdp.Input{Type: "mouse_wheel", Delta: int(int16(wparam >> 16))})
	case wmKeyDown:
		v.send(rdp.Input{Type: "key_down", VK: uint16(wparam)})
	case wmKeyUp:
		v.send(rdp.Input{Type: "key_up", VK: uint16(wparam)})
	}
	value, _, _ := defWindowProc.Call(hwnd, uintptr(message), wparam, lparam)
	return value
}
func (v *viewer) mapMouse(hwnd uintptr, x, y int) (int, int) {
	v.mu.RLock()
	iw, ih := v.width, v.height
	v.mu.RUnlock()
	var client rect
	getClientRect.Call(hwnd, uintptr(unsafe.Pointer(&client)))
	cw, ch := int(client.Right), int(client.Bottom)
	if iw < 1 || ih < 1 || cw < 1 || ch < 1 {
		return 0, 0
	}
	dw, dh := cw, cw*ih/iw
	if dh > ch {
		dh = ch
		dw = ch * iw / ih
	}
	offX, offY := (cw-dw)/2, (ch-dh)/2
	x = min(max(x-offX, 0), dw-1)
	y = min(max(y-offY, 0), dh-1)
	return x * iw / max(1, dw-1), y * ih / max(1, dh-1)
}

func (v *viewer) paint(hwnd uintptr) {
	var paint paintStruct
	hdc, _, _ := beginPaint.Call(hwnd, uintptr(unsafe.Pointer(&paint)))
	defer endPaint.Call(hwnd, uintptr(unsafe.Pointer(&paint)))
	v.mu.RLock()
	defer v.mu.RUnlock()
	if v.image == nil {
		return
	}
	var client rect
	getClientRect.Call(hwnd, uintptr(unsafe.Pointer(&client)))
	cw, ch := int(client.Right), int(client.Bottom)
	iw, ih := v.width, v.height
	if cw < 1 || ch < 1 || iw < 1 || ih < 1 {
		return
	}
	dw, dh := cw, cw*ih/iw
	if dh > ch {
		dh = ch
		dw = ch * iw / ih
	}
	x, y := (cw-dw)/2, (ch-dh)/2
	info := bitmapInfo{Header: bitmapInfoHeader{Size: uint32(unsafe.Sizeof(bitmapInfoHeader{})), Width: int32(iw), Height: -int32(ih), Planes: 1, BitCount: 32, Compression: biRGB}}
	stretchDIBits.Call(hdc, uintptr(x), uintptr(y), uintptr(dw), uintptr(dh), 0, 0, uintptr(iw), uintptr(ih), uintptr(unsafe.Pointer(&v.image.Pix[0])), uintptr(unsafe.Pointer(&info)), 0, 0x00cc0020)
}
func main() {
	version := flag.Bool("version", false, "Show RDP product version")
	channel := flag.Bool("release-channel", false, "Show embedded release channel")
	path := flag.String("connection", "", "One-time .sgrdp connection file")
	flag.Parse()
	if *version || *channel {
		if *path != "" || flag.NArg() != 0 || (*version && *channel) {
			log.Fatal("Conflicting RDP diagnostic modes")
		}
		if *version {
			fmt.Printf("SentinelGrid RDP %s\n", buildinfo.Version())
		} else {
			fmt.Println(buildinfo.Channel)
		}
		return
	}
	if flag.NArg() != 0 || *path == "" {
		log.Fatal("Usage: SentinelGridRDP.exe -connection <download.sgrdp>")
	}
	if err := run(*path); err != nil {
		log.Fatal(err)
	}
}
