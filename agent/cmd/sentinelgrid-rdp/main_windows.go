//go:build windows

package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"log"
	"net"
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
	frameBytes                    uint64
	statsStarted                  time.Time
	frameNotificationPending      bool
	compressed                    *latestCompressedFrame
	closeRequested                bool
	done                          chan struct{}
}
type viewerLogger struct {
	mu   sync.Mutex
	file *os.File
}

// viewerLogPaths uses locations owned by the interactive user, not ProgramData,
// which can be intentionally unavailable to a non-elevated protocol handler.
func viewerLogPaths() []string {
	paths := make([]string, 0, 2)
	if cacheDir, err := os.UserCacheDir(); err == nil && cacheDir != "" {
		paths = append(paths, filepath.Join(cacheDir, "SentinelGrid", "logs", "viewer.log"))
	}
	if tempDir := os.TempDir(); tempDir != "" {
		fallback := filepath.Join(tempDir, "SentinelGrid", "logs", "viewer.log")
		if len(paths) == 0 || !samePath(paths[0], fallback) {
			paths = append(paths, fallback)
		}
	}
	return paths
}

func samePath(a, b string) bool { return filepath.Clean(a) == filepath.Clean(b) }

func openViewerLogger() (*viewerLogger, error) {
	return openViewerLoggerAt(viewerLogPaths())
}

func openViewerLoggerAt(paths []string) (*viewerLogger, error) {
	var lastErr error
	for index, path := range paths {
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			lastErr = err
			continue
		}
		file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
		if err != nil {
			lastErr = err
			continue
		}
		logger := &viewerLogger{file: file}
		if index > 0 {
			logger.event("VIEWER_LOGGER_FALLBACK location=temp")
		}
		return logger, nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no per-user log location is available")
	}
	return nil, fmt.Errorf("open viewer diagnostic log: %w", lastErr)
}
func (l *viewerLogger) event(event string) {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.file == nil {
		return
	}
	_, _ = fmt.Fprintf(l.file, "%s %s\n", time.Now().UTC().Format(time.RFC3339), event)
}
func (l *viewerLogger) close() {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.file != nil {
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
	return runViewerConnecting(func(ctx context.Context, _ *viewerLogger) (*websocket.Conn, error) { return rdp.Dial(ctx, connection) })
}

func runViewer(ws *websocket.Conn) error {
	return runViewerConnecting(func(context.Context, *viewerLogger) (*websocket.Conn, error) { return ws, nil })
}

type viewerConnect func(context.Context, *viewerLogger) (*websocket.Conn, error)

func runViewerConnecting(connect viewerConnect) error {
	logger, err := openViewerLogger()
	if err != nil {
		// A missing diagnostic destination must not prevent the interactive viewer
		// from opening. The normal per-user and temporary fallbacks cover expected ACL issues.
		log.Print("SentinelGrid viewer diagnostics unavailable")
		logger = &viewerLogger{}
	}
	defer logger.close()
	logger.event("VIEWER_START")
	v := &viewer{logger: logger, status: "Connecting to remote device...", done: make(chan struct{}), statsStarted: time.Now(), compressed: newLatestCompressedFrame()}
	activeViewer = v
	sessionCtx, cancelSession := context.WithCancel(context.Background())
	go func() {
		defer close(v.done)
		ctx, cancel := context.WithTimeout(sessionCtx, 30*time.Second)
		defer cancel()
		v.setStatus("Establishing secure session...")
		v.logger.event("VIEWER_RELAY_CONNECT_START")
		ws, err := connect(ctx, v.logger)
		if err != nil {
			v.logger.event("VIEWER_RELAY_CONNECT_FAILED category=connect")
			v.fail("Unable to start remote session")
			return
		}
		v.mu.Lock()
		v.ws = ws
		v.mu.Unlock()
		v.logger.event("VIEWER_RELAY_CONNECTED")
		v.setStatus("Starting video...")
		go v.decodeFrames()
		v.receive()
	}()
	windowErr := v.window()
	cancelSession()
	v.mu.RLock()
	ws := v.ws
	v.mu.RUnlock()
	if ws != nil {
		_ = ws.Close()
	}
	select {
	case <-v.done:
	case <-time.After(2 * time.Second):
		logger.event("VIEWER_RELAY_CLOSE_WAIT_TIMEOUT")
	}
	logger.event("VIEWER_EXIT")
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

func (v *viewer) requestClose() {
	v.mu.Lock()
	v.closeRequested = true
	v.mu.Unlock()
}

func (v *viewer) wasCloseRequested() bool {
	v.mu.RLock()
	defer v.mu.RUnlock()
	return v.closeRequested
}

func maxFloat(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

func relayCloseCategory(err error) string {
	var closeErr *websocket.CloseError
	if errors.As(err, &closeErr) {
		switch closeErr.Code {
		case websocket.CloseNormalClosure:
			return "normal"
		case websocket.CloseGoingAway:
			return "going_away"
		case websocket.ClosePolicyViolation:
			return "policy"
		case websocket.CloseMessageTooBig:
			return "message_too_big"
		case websocket.CloseAbnormalClosure:
			return "abnormal"
		default:
			return "websocket_close"
		}
	}
	var errno syscall.Errno
	if errors.As(err, &errno) && (errno == syscall.Errno(10053) || errno == syscall.Errno(10054)) {
		return "network_reset"
	}
	var networkErr net.Error
	if errors.As(err, &networkErr) {
		return "network_error"
	}
	return "abnormal"
}
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
			if v.wasCloseRequested() {
				v.logger.event("VIEWER_RELAY_CLOSED category=client_close")
			} else {
				v.logger.event(fmt.Sprintf("VIEWER_RELAY_CLOSED category=%s", relayCloseCategory(err)))
			}
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
			metadata, jpegData, parseErr := rdp.ParseFramePacket(data)
			if parseErr != nil {
				v.logger.event("VIEWER_FRAME_INVALID")
				continue
			}
			v.compressed.replace(compressedFrame{data: jpegData, metadata: metadata})
		}
	}
}

func (v *viewer) decodeFrames() {
	for range v.compressed.ready {
		for {
			compressed, ok := v.compressed.take()
			if !ok {
				break
			}
			started := time.Now()
			decoded, err := jpeg.Decode(bytesReader(compressed.data))
			if err != nil {
				v.logger.event("VIEWER_JPEG_DECODE_FAILED")
				continue
			}
			frame := rgbaToBGRA(toRGBA(decoded))
			decode := time.Since(started)
			v.mu.Lock()
			first := len(v.frame.pixels) == 0
			v.frame = frame
			v.framesReceived++
			v.frameBytes += uint64(len(compressed.data))
			received, painted, bytes := v.framesReceived, v.framesPainted, v.frameBytes
			elapsed := time.Since(v.statsStarted).Seconds()
			hwnd := v.hwnd
			notify := hwnd != 0 && !v.frameNotificationPending
			if notify {
				v.frameNotificationPending = true
			}
			v.status = ""
			v.mu.Unlock()
			if first {
				v.logger.event(fmt.Sprintf("VIEWER_FIRST_FRAME bytes=%d", len(compressed.data)))
			}
			if received%120 == 0 {
				age := int64(0)
				if !compressed.metadata.CaptureTimestamp.IsZero() {
					age = time.Since(compressed.metadata.CaptureTimestamp).Milliseconds()
				}
				v.logger.event(fmt.Sprintf("VIEWER_FRAME_STATS received=%d painted=%d received_fps=%.1f avg_bytes=%d jpeg_decode_ms=%.1f frame_age_ms=%d stale_dropped=%d", received, painted, float64(received)/maxFloat(elapsed, 0.001), bytes/received, float64(decode.Microseconds())/1000, age, v.compressed.dropCount()))
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
	case wmClose:
		v.logger.event("VIEWER_CLOSE_REQUESTED")
		v.requestClose()
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
