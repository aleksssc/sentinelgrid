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
	wmEraseBkgnd       = 0x0014
	wmSetFocus         = 0x0007
	wmClose            = 0x0010
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
	wmFrameReady       = 0x8001
	wmStateChanged     = 0x8002
	wsOverlappedWindow = 0x00cf0000
	csHRedraw          = 0x0002
	csVRedraw          = 0x0001
	swShow             = 5
	biRGB              = 0
	blackBrush         = 4
	transparent        = 1
)

type viewer struct {
	mu                            sync.RWMutex
	writeMu                       sync.Mutex
	ws                            *websocket.Conn
	frame                         viewerFrame
	hwnd                          uintptr
	status                        string
	logger                        *viewerLogger
	framesReceived, framesPainted uint64
	frameNotificationPending      bool
}
type viewerLogger struct {
	mu   sync.Mutex
	file *os.File
}

func openViewerLogger() *viewerLogger {
	programData := os.Getenv("ProgramData")
	if programData == "" {
		return nil
	}
	directory := filepath.Join(programData, "SentinelGrid", "logs")
	if os.MkdirAll(directory, 0755) != nil {
		return nil
	}
	file, err := os.OpenFile(filepath.Join(directory, "viewer.log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return nil
	}
	return &viewerLogger{file: file}
}
func (l *viewerLogger) event(event string) {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	_, _ = fmt.Fprintf(l.file, "%s %s\n", time.Now().UTC().Format(time.RFC3339), event)
}
func (l *viewerLogger) close() {
	if l != nil {
		l.mu.Lock()
		defer l.mu.Unlock()
		_ = l.file.Close()
	}
}

var activeViewer *viewer
var viewerUser32 = syscall.NewLazyDLL("user32.dll")
var viewerGDI32 = syscall.NewLazyDLL("gdi32.dll")
var viewerKernel32 = syscall.NewLazyDLL("kernel32.dll")
var registerClassEx = viewerUser32.NewProc("RegisterClassExW")
var createWindowEx = viewerUser32.NewProc("CreateWindowExW")
var defWindowProc = viewerUser32.NewProc("DefWindowProcW")
var getMessage = viewerUser32.NewProc("GetMessageW")
var translateMessage = viewerUser32.NewProc("TranslateMessage")
var dispatchMessage = viewerUser32.NewProc("DispatchMessageW")
var postQuitMessage = viewerUser32.NewProc("PostQuitMessage")
var postMessage = viewerUser32.NewProc("PostMessageW")
var beginPaint = viewerUser32.NewProc("BeginPaint")
var endPaint = viewerUser32.NewProc("EndPaint")
var invalidateRect = viewerUser32.NewProc("InvalidateRect")
var getClientRect = viewerUser32.NewProc("GetClientRect")
var setFocus = viewerUser32.NewProc("SetFocus")
var fillRect = viewerUser32.NewProc("FillRect")
var drawText = viewerUser32.NewProc("DrawTextW")
var getModuleHandle = viewerKernel32.NewProc("GetModuleHandleW")
var getStockObject = viewerGDI32.NewProc("GetStockObject")
var setTextColor = viewerGDI32.NewProc("SetTextColor")
var setBkMode = viewerGDI32.NewProc("SetBkMode")
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

// wndClassEx matches WNDCLASSEXW exactly on Windows amd64.
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
	return runViewerConnecting(func(ctx context.Context) (*websocket.Conn, error) { return rdp.Dial(ctx, connection) })
}

func runViewer(ws *websocket.Conn) error {
	return runViewerConnecting(func(context.Context) (*websocket.Conn, error) { return ws, nil })
}
func runViewerConnecting(connect func(context.Context) (*websocket.Conn, error)) error {
	logger := openViewerLogger()
	defer logger.close()
	logger.event("VIEWER_START")
	v := &viewer{logger: logger, status: "Connecting to remote device..."}
	activeViewer = v
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		v.setStatus("Establishing secure session...")
		ws, err := connect(ctx)
		if err != nil {
			v.fail("Unable to start remote session")
			return
		}
		v.mu.Lock()
		v.ws = ws
		v.mu.Unlock()
		v.logger.event("VIEWER_RELAY_CONNECTED")
		v.setStatus("Starting video...")
		v.receive()
	}()
	windowErr := v.window()
	v.mu.RLock()
	ws := v.ws
	v.mu.RUnlock()
	if ws != nil {
		_ = ws.Close()
	}
	return windowErr
}
func (v *viewer) setStatus(status string) {
	v.mu.Lock()
	v.status = status
	hwnd := v.hwnd
	v.mu.Unlock()
	if hwnd != 0 {
		postMessage.Call(hwnd, wmStateChanged, 0, 0)
	}
}
func (v *viewer) fail(status string) { v.logger.event("VIEWER_SESSION_FAILED"); v.setStatus(status) }
func (v *viewer) receive() {
	for {
		v.mu.RLock()
		ws := v.ws
		v.mu.RUnlock()
		if ws == nil {
			return
		}
		kind, data, err := ws.ReadMessage()
		if err != nil {
			v.logger.event("VIEWER_RELAY_CLOSED")
			v.mu.RLock()
			hasFrame, hwnd := len(v.frame.pixels) != 0, v.hwnd
			v.mu.RUnlock()
			if !hasFrame {
				v.fail("Remote session ended")
			}
			if hwnd != 0 {
				postMessage.Call(hwnd, wmStateChanged, 0, 0)
			}
			return
		}
		if kind != websocket.BinaryMessage || len(data) < 2 {
			continue
		}
		switch data[0] {
		case rdp.PacketInfo:
			var info rdp.ScreenInfo
			if json.Unmarshal(data[1:], &info) == nil && info.Width > 0 && info.Height > 0 {
				v.logger.event(fmt.Sprintf("VIEWER_SCREEN_INFO width=%d height=%d", info.Width, info.Height))
			}
		case rdp.PacketFrame:
			decoded, err := jpeg.Decode(bytesReader(data[1:]))
			if err != nil {
				v.logger.event("VIEWER_JPEG_DECODE_FAILED")
				continue
			}
			rgba := toRGBA(decoded)
			frame := rgbaToBGRA(rgba)
			v.mu.Lock()
			first := len(v.frame.pixels) == 0
			v.frame = frame
			v.framesReceived++
			received := v.framesReceived
			hwnd := v.hwnd
			notify := hwnd != 0 && !v.frameNotificationPending
			if notify {
				v.frameNotificationPending = true
			}
			v.status = ""
			v.mu.Unlock()
			if first {
				v.logger.event("VIEWER_FIRST_FRAME")
			}
			if received%120 == 0 {
				v.logger.event(fmt.Sprintf("VIEWER_FRAME_STATS received=%d", received))
			}
			if notify {
				if result, _, _ := postMessage.Call(hwnd, wmFrameReady, 0, 0); result == 0 {
					v.mu.Lock()
					v.frameNotificationPending = false
					v.mu.Unlock()
				}
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
	v.mu.RLock()
	ws := v.ws
	v.mu.RUnlock()
	if ws == nil {
		return
	}
	v.writeMu.Lock()
	defer v.writeMu.Unlock()
	if err := ws.WriteMessage(websocket.BinaryMessage, packet); err != nil {
		v.logger.event("VIEWER_INPUT_SEND_FAILED")
	}
}
func win32Error(err error) string {
	if errno, ok := err.(syscall.Errno); ok && errno != 0 {
		return fmt.Sprintf("win32_%d", errno)
	}
	return "unknown"
}
func (v *viewer) window() error {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	class, _ := syscall.UTF16PtrFromString("SentinelGridRemoteViewer")
	title, _ := syscall.UTF16PtrFromString("SentinelGrid Remote")
	instance, _, instanceErr := getModuleHandle.Call(0)
	if instance == 0 {
		v.logger.event(fmt.Sprintf("VIEWER_WINDOW_FAILED stage=register_class error=%s", win32Error(instanceErr)))
		return fmt.Errorf("could not get viewer module handle: %s", win32Error(instanceErr))
	}
	callback := syscall.NewCallback(viewerProc)
	wc := wndClassEx{
		Size:       uint32(unsafe.Sizeof(wndClassEx{})),
		Style:      csHRedraw | csVRedraw,
		WndProc:    callback,
		Instance:   instance,
		ClassName:  class,
		Background: getStockObjectValue(blackBrush),
	}
	if atom, _, err := registerClassEx.Call(uintptr(unsafe.Pointer(&wc))); atom == 0 {
		v.logger.event(fmt.Sprintf("VIEWER_WINDOW_FAILED stage=register_class error=%s", win32Error(err)))
		return fmt.Errorf("could not register viewer window: %s", win32Error(err))
	}
	v.logger.event("VIEWER_REGISTER_CLASS_OK")
	hwnd, _, err := createWindowEx.Call(0, uintptr(unsafe.Pointer(class)), uintptr(unsafe.Pointer(title)), wsOverlappedWindow, 100, 100, 1280, 800, 0, 0, instance, 0)
	if hwnd == 0 {
		v.logger.event(fmt.Sprintf("VIEWER_WINDOW_FAILED stage=create_window error=%s", win32Error(err)))
		return fmt.Errorf("could not create viewer window: %s", win32Error(err))
	}
	v.logger.event("VIEWER_WINDOW_CREATED")
	v.mu.Lock()
	v.hwnd = hwnd
	notify := len(v.frame.pixels) != 0 && !v.frameNotificationPending
	if notify {
		v.frameNotificationPending = true
	}
	v.mu.Unlock()
	viewerUser32.NewProc("ShowWindow").Call(hwnd, swShow)
	viewerUser32.NewProc("UpdateWindow").Call(hwnd)
	v.logger.event("VIEWER_WINDOW_SHOWN")
	if notify {
		postMessage.Call(hwnd, wmFrameReady, 0, 0)
	}
	var message msg
	for {
		result, _, err := getMessage.Call(uintptr(unsafe.Pointer(&message)), 0, 0, 0)
		if int32(result) <= 0 {
			if result == ^uintptr(0) {
				return fmt.Errorf("viewer message error: %s", win32Error(err))
			}
			return nil
		}
		translateMessage.Call(uintptr(unsafe.Pointer(&message)))
		dispatchMessage.Call(uintptr(unsafe.Pointer(&message)))
	}
}
func getStockObjectValue(which int) uintptr {
	value, _, _ := getStockObject.Call(uintptr(which))
	return value
}
func viewerProc(hwnd uintptr, message uint32, wparam, lparam uintptr) uintptr {
	v := activeViewer
	if v == nil {
		value, _, _ := defWindowProc.Call(hwnd, uintptr(message), wparam, lparam)
		return value
	}
	switch message {
	case wmDestroy:
		v.logger.event("VIEWER_CLOSE")
		postQuitMessage.Call(0)
		return 0
	case wmSetFocus:
		setFocus.Call(hwnd)
	case wmEraseBkgnd:
		v.mu.RLock()
		hasFrame := len(v.frame.pixels) != 0
		v.mu.RUnlock()
		if hasFrame {
			return 1
		}
	case wmFrameReady:
		v.mu.Lock()
		v.frameNotificationPending = false
		v.mu.Unlock()
		invalidateRect.Call(hwnd, 0, 0, 0)
		return 0
	case wmStateChanged:
		invalidateRect.Call(hwnd, 0, 0, 0)
		return 0
	case wmPaint:
		v.paint(hwnd)
		return 0
	case wmMouseMove:
		v.sendMouse(hwnd, "mouse_move", "", 0, lparam)
	case wmLButtonDown:
		v.sendMouse(hwnd, "mouse_down", "left", 0, lparam)
	case wmLButtonUp:
		v.sendMouse(hwnd, "mouse_up", "left", 0, lparam)
	case wmRButtonDown:
		v.sendMouse(hwnd, "mouse_down", "right", 0, lparam)
	case wmRButtonUp:
		v.sendMouse(hwnd, "mouse_up", "right", 0, lparam)
	case wmMButtonDown:
		v.sendMouse(hwnd, "mouse_down", "middle", 0, lparam)
	case wmMButtonUp:
		v.sendMouse(hwnd, "mouse_up", "middle", 0, lparam)
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
func (v *viewer) sendMouse(hwnd uintptr, kind, button string, delta int, lparam uintptr) {
	x, y, ok := v.mapMouse(hwnd, int(int16(lparam)), int(int16(lparam>>16)))
	if !ok {
		return
	}
	v.send(rdp.Input{Type: kind, X: x, Y: y, Button: button, Delta: delta})
}
func (v *viewer) mapMouse(hwnd uintptr, x, y int) (int, int, bool) {
	v.mu.RLock()
	frame := v.frame
	v.mu.RUnlock()
	var client rect
	getClientRect.Call(hwnd, uintptr(unsafe.Pointer(&client)))
	return mapClientPoint(int(client.Right), int(client.Bottom), frame.width, frame.height, x, y)
}
func (v *viewer) paint(hwnd uintptr) {
	var paint paintStruct
	hdc, _, _ := beginPaint.Call(hwnd, uintptr(unsafe.Pointer(&paint)))
	defer endPaint.Call(hwnd, uintptr(unsafe.Pointer(&paint)))
	var client rect
	getClientRect.Call(hwnd, uintptr(unsafe.Pointer(&client)))
	black := getStockObjectValue(blackBrush)
	fill := func(area rect) {
		if area.Right > area.Left && area.Bottom > area.Top {
			fillRect.Call(hdc, uintptr(unsafe.Pointer(&area)), black)
		}
	}

	v.mu.RLock()
	frame, status := v.frame, v.status
	v.mu.RUnlock()
	if len(frame.pixels) == 0 {
		fill(client)
		v.paintStatus(hdc, client, status)
		return
	}
	display, ok := fittedImageRect(int(client.Right), int(client.Bottom), frame.width, frame.height)
	if !ok {
		return
	}
	// Preserve the displayed frame and repaint only the areas not covered by it.
	fill(rect{Left: client.Left, Top: client.Top, Right: client.Right, Bottom: int32(display.y)})
	fill(rect{Left: client.Left, Top: int32(display.y + display.height), Right: client.Right, Bottom: client.Bottom})
	fill(rect{Left: client.Left, Top: int32(display.y), Right: int32(display.x), Bottom: int32(display.y + display.height)})
	fill(rect{Left: int32(display.x + display.width), Top: int32(display.y), Right: client.Right, Bottom: int32(display.y + display.height)})
	info := bitmapInfo{Header: bitmapInfoHeader{Size: uint32(unsafe.Sizeof(bitmapInfoHeader{})), Width: int32(frame.width), Height: -int32(frame.height), Planes: 1, BitCount: 32, Compression: biRGB}}
	if copied, _, _ := stretchDIBits.Call(hdc, uintptr(display.x), uintptr(display.y), uintptr(display.width), uintptr(display.height), 0, 0, uintptr(frame.width), uintptr(frame.height), uintptr(unsafe.Pointer(&frame.pixels[0])), uintptr(unsafe.Pointer(&info)), 0, 0x00cc0020); copied != ^uintptr(0) {
		v.mu.Lock()
		v.framesPainted++
		painted := v.framesPainted
		v.mu.Unlock()
		if painted%120 == 0 {
			v.logger.event(fmt.Sprintf("VIEWER_PAINT_STATS painted=%d", painted))
		}
	}
}
func (v *viewer) paintStatus(hdc uintptr, client rect, status string) {
	if status == "" {
		status = "Connecting to remote device..."
	}
	title, _ := syscall.UTF16PtrFromString("SentinelGrid Remote")
	message, _ := syscall.UTF16PtrFromString(status)
	setBkMode.Call(hdc, transparent)
	setTextColor.Call(hdc, 0x00FFFFFF)
	titleRect := rect{Left: 40, Top: 40, Right: client.Right - 40, Bottom: 90}
	messageRect := rect{Left: 40, Top: 95, Right: client.Right - 40, Bottom: 145}
	drawText.Call(hdc, uintptr(unsafe.Pointer(title)), ^uintptr(0), uintptr(unsafe.Pointer(&titleRect)), 0)
	setTextColor.Call(hdc, 0x00C0C0C0)
	drawText.Call(hdc, uintptr(unsafe.Pointer(message)), ^uintptr(0), uintptr(unsafe.Pointer(&messageRect)), 0)
}
func main() {
	if len(os.Args) == 3 && os.Args[1] == "-uri" {
		if err := runURI(os.Args[2]); err != nil {
			log.Print("SentinelGrid Remote could not start: ", err)
		}
		return
	}
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
