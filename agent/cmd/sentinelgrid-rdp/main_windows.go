//go:build windows

package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
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
	wmSize             = 0x0005
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
	wmTimer            = 0x0113
	framePresentTimer  = 1
	framePresentPeriod = 16
	wsOverlappedWindow = 0x00cf0000
	csHRedraw          = 0x0002
	csVRedraw          = 0x0001
	swShow             = 5
	biRGB              = 0
	blackBrush         = 4
	transparent        = 1
	psSolid            = 0
	dtLeft             = 0x00000000
	dtCenter           = 0x00000001
	dtVCenter          = 0x00000004
	dtSingleLine       = 0x00000020
	dtEndEllipsis      = 0x00008000
	fontWeightNormal   = 400
	fontWeightSemiBold = 600
	fontWeightBold     = 700
)

type viewer struct {
	mu                        sync.RWMutex
	writeMu                   sync.Mutex
	ws                        *websocket.Conn
	frame                     viewerFrame
	frameGeneration           uint64
	hwnd                      uintptr
	status                    string
	logger                    *viewerLogger
	compressed                *latestCompressedFrame
	closeRequested            bool
	sessionClosed             bool
	done                      chan struct{}
	renderer                  *nativeRenderer
	rendererBackend           string
	decoder                   *nativeH264Decoder
	videoCodec                string
	screenWidth, screenHeight int
	lastKeyframeRequest       time.Time
	input                     *viewerInputSender

	socketReceived, decodeStarted, decodedCompleted     uint64
	frameBytes                                          uint64
	statsStarted, statsReported                         time.Time
	lastStatsSocket, lastStatsDecoded, lastStatsPainted uint64
	notification                                        frameNotificationState
	paintState                                          framePaintState
	paintLogged, paintFailureLogged                     bool
	h264FirstFrameLogged, h264PresentationLogged        bool
	presentAttempts, successfulPresents                 uint64
	zeroResultPresents, gdiErrorPresents                uint64
	lastSuccessfulGeneration                            uint64
	decodeMetrics                                       durationWindow
	conversionMetrics                                   durationWindow
	bufferCopyMetrics, presentMetrics                   durationWindow
	loadingAnimationStarted, lastLoadingInvalidate      time.Time
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
var setTimer = viewerUser32.NewProc("SetTimer")
var killTimer = viewerUser32.NewProc("KillTimer")
var getWindowDC = viewerUser32.NewProc("GetDC")
var releaseWindowDC = viewerUser32.NewProc("ReleaseDC")
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
var createSolidBrush = viewerGDI32.NewProc("CreateSolidBrush")
var createPen = viewerGDI32.NewProc("CreatePen")
var selectObject = viewerGDI32.NewProc("SelectObject")
var deleteObject = viewerGDI32.NewProc("DeleteObject")
var moveToEx = viewerGDI32.NewProc("MoveToEx")
var lineTo = viewerGDI32.NewProc("LineTo")
var polygon = viewerGDI32.NewProc("Polygon")
var createFont = viewerGDI32.NewProc("CreateFontW")
var ellipse = viewerGDI32.NewProc("Ellipse")

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
	started := time.Now()
	v := &viewer{logger: logger, status: "Connecting to remote device...", done: make(chan struct{}), statsStarted: started, statsReported: started, compressed: newLatestCompressedFrame(), decodeMetrics: newDurationWindow(120), conversionMetrics: newDurationWindow(120), bufferCopyMetrics: newDurationWindow(120), presentMetrics: newDurationWindow(120), loadingAnimationStarted: started}
	v.input = newViewerInputSender(v)
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
	v.input.close()
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
		closed := v.sessionClosed
		v.mu.RUnlock()
		if ws == nil || closed {
			return
		}
		kind, data, err := ws.ReadMessage()
		if err != nil {
			if v.wasCloseRequested() {
				v.logger.event("VIEWER_RELAY_CLOSED category=client_close")
			} else {
				v.logger.event(fmt.Sprintf("VIEWER_RELAY_CLOSED category=%s", relayCloseCategory(err)))
			}
			v.mu.Lock()
			v.sessionClosed = true
			hasFrame, hwnd := len(v.frame.pixels) != 0, v.hwnd
			v.notification.cancel()
			v.mu.Unlock()
			v.compressed.close()
			if !hasFrame {
				v.fail("Remote session ended")
			} else if hwnd != 0 {
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
				v.mu.Lock()
				v.screenWidth, v.screenHeight = info.Width, info.Height
				v.mu.Unlock()
				v.configureVideoCapabilities(info.Width, info.Height)
			}
		case rdp.PacketVideoSelected:
			v.handleVideoSelected(data)
		case rdp.PacketH264AccessUnit:
			v.handleH264AccessUnit(data)
		case rdp.PacketFrame:
			metadata, jpegData, parseErr := rdp.ParseFramePacket(data)
			if parseErr != nil {
				v.logger.event("VIEWER_FRAME_INVALID")
				continue
			}
			v.mu.Lock()
			v.socketReceived++
			v.mu.Unlock()
			v.compressed.replace(compressedFrame{data: jpegData, metadata: metadata})
		}
	}
}
func (v *viewer) decodeFrames() {
	for {
		select {
		case <-v.compressed.done:
			return
		case <-v.compressed.ready:
		}
		for {
			compressed, ok := v.compressed.take()
			if !ok {
				break
			}
			v.mu.Lock()
			v.decodeStarted++
			v.mu.Unlock()
			decodeStarted := time.Now()
			decoded, err := jpeg.Decode(bytesReader(compressed.data))
			decodeDuration := time.Since(decodeStarted)
			if err != nil {
				v.logger.event("VIEWER_JPEG_DECODE_FAILED")
				continue
			}
			conversionStarted := time.Now()
			frame := imageToBGRA(decoded)
			conversionDuration := time.Since(conversionStarted)
			if !frame.valid() {
				v.logger.event(fmt.Sprintf("VIEWER_FRAME_BUFFER_INVALID width=%d height=%d stride=%d length=%d", frame.width, frame.height, frame.stride, len(frame.pixels)))
				continue
			}
			// The converted frame is the display buffer; no additional full-frame copy is made.
			bufferCopyDuration := time.Duration(0)
			v.mu.Lock()
			if v.sessionClosed {
				v.mu.Unlock()
				return
			}
			first := len(v.frame.pixels) == 0
			v.frame = frame
			v.frameGeneration++
			v.decodedCompleted++
			v.frameBytes += uint64(len(compressed.data))
			v.decodeMetrics.add(decodeDuration)
			v.conversionMetrics.add(conversionDuration)
			v.bufferCopyMetrics.add(bufferCopyDuration)
			decodedCount, decodeStartedCount, socketCount, bytes := v.decodedCompleted, v.decodeStarted, v.socketReceived, v.frameBytes
			paintEvents, uniquePainted := v.paintState.paintEvents, v.paintState.uniqueFramesPainted
			now := time.Now()
			hwnd := v.hwnd
			notify := hwnd != 0 && v.notification.schedule()
			v.mu.Unlock()
			if first {
				nonZero, variation := frame.pixelSummary()
				v.logger.event(fmt.Sprintf("VIEWER_FRAME_PIXELS width=%d height=%d stride=%d length=%d nonzero=%t variation=%t", frame.width, frame.height, frame.stride, len(frame.pixels), nonZero, variation))
				v.logger.event(fmt.Sprintf("VIEWER_FIRST_FRAME bytes=%d", len(compressed.data)))
			}
			if decodedCount%120 == 0 {
				decodeStats, conversionStats, copyStats := v.decodeMetrics.snapshot(), v.conversionMetrics.snapshot(), v.bufferCopyMetrics.snapshot()
				da, dp50, dp95, dmax := milliseconds(decodeStats)
				ca, cp50, cp95, cmax := milliseconds(conversionStats)
				ba, bp50, bp95, bmax := milliseconds(copyStats)
				age := int64(0)
				if !compressed.metadata.CaptureTimestamp.IsZero() {
					age = time.Since(compressed.metadata.CaptureTimestamp).Milliseconds()
				}
				v.mu.Lock()
				interval := maxFloat(now.Sub(v.statsReported).Seconds(), .001)
				socketFPS := float64(socketCount-v.lastStatsSocket) / interval
				decodedFPS := float64(decodedCount-v.lastStatsDecoded) / interval
				paintedFPS := float64(uniquePainted-v.lastStatsPainted) / interval
				v.lastStatsSocket, v.lastStatsDecoded, v.lastStatsPainted, v.statsReported = socketCount, decodedCount, uniquePainted, now
				v.mu.Unlock()
				v.logger.event(fmt.Sprintf("VIEWER_FRAME_STATS compressed_received=%d decode_started=%d decode_completed=%d paint_events=%d unique_frames_painted=%d socket_received_fps=%.1f decoded_fps=%.1f unique_painted_fps=%.1f avg_bytes=%d jpeg_decode_ms=avg:%.1f/p50:%.1f/p95:%.1f/max:%.1f pixel_conversion_ms=avg:%.1f/p50:%.1f/p95:%.1f/max:%.1f display_buffer_copy_ms=avg:%.1f/p50:%.1f/p95:%.1f/max:%.1f frame_age_ms=%d compressed_dropped=%d", socketCount, decodeStartedCount, decodedCount, paintEvents, uniquePainted, socketFPS, decodedFPS, paintedFPS, bytes/decodedCount, da, dp50, dp95, dmax, ca, cp50, cp95, cmax, ba, bp50, bp95, bmax, age, v.compressed.dropCount()))
				v.logPresentStats(decodedCount, paintedFPS)
			}
			if notify {
				v.postFrameReady(hwnd)
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
func (v *viewer) inputEnabled() bool {
	v.mu.RLock()
	defer v.mu.RUnlock()
	return v.ws != nil && !v.sessionClosed
}

func (v *viewer) queueInput(input rdp.Input) {
	if !v.inputEnabled() || v.input == nil {
		return
	}
	if input.Type == "mouse_move" {
		v.input.enqueueMouseMove(input)
		return
	}
	v.input.enqueueCritical(input)
}

func (v *viewer) writeInput(input rdp.Input) error {
	data, err := json.Marshal(input)
	if err != nil {
		return err
	}
	packet := append([]byte{rdp.PacketInput}, data...)
	v.writeMu.Lock()
	defer v.writeMu.Unlock()
	v.mu.RLock()
	ws := v.ws
	closed := v.sessionClosed
	v.mu.RUnlock()
	if ws == nil || closed {
		return errors.New("viewer input session is closed")
	}
	return ws.WriteMessage(websocket.BinaryMessage, packet)
}
func win32Error(err error) string {
	if errno, ok := err.(syscall.Errno); ok && errno != 0 {
		return fmt.Sprintf("win32_%d", errno)
	}
	return "unknown"
}
func (v *viewer) postFrameReady(hwnd uintptr) {
	if result, _, err := postMessage.Call(hwnd, wmFrameReady, 0, 0); result == 0 {
		v.mu.Lock()
		v.notification.cancel()
		v.mu.Unlock()
		v.logger.event(fmt.Sprintf("VIEWER_FRAME_READY_POST_FAILED error=%s", win32Error(err)))
	}
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
	if renderer, rendererErr := newNativeRenderer(hwnd); rendererErr == nil {
		v.mu.Lock()
		v.renderer, v.rendererBackend = renderer, "d3d11"
		v.mu.Unlock()
		v.logger.event("VIEWER_RENDERER backend=d3d11")
		v.mu.RLock()
		screenWidth, screenHeight := v.screenWidth, v.screenHeight
		v.mu.RUnlock()
		if screenWidth > 0 && screenHeight > 0 {
			v.configureVideoCapabilities(screenWidth, screenHeight)
		}
	} else {
		v.mu.Lock()
		v.rendererBackend = "gdi"
		v.mu.Unlock()
		v.logger.event("VIEWER_RENDERER backend=gdi reason=initialization_failed")
	}
	if timer, _, timerErr := setTimer.Call(hwnd, framePresentTimer, framePresentPeriod, 0); timer == 0 {
		v.logger.event(fmt.Sprintf("VIEWER_PRESENT_TIMER_FAILED error=%s", win32Error(timerErr)))
	}
	v.mu.Lock()
	v.hwnd = hwnd
	notify := len(v.frame.pixels) != 0 && v.notification.schedule()
	v.mu.Unlock()
	viewerUser32.NewProc("ShowWindow").Call(hwnd, swShow)
	viewerUser32.NewProc("UpdateWindow").Call(hwnd)
	v.logger.event("VIEWER_WINDOW_SHOWN")
	if notify {
		v.postFrameReady(hwnd)
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
		killTimer.Call(hwnd, framePresentTimer)
		v.mu.Lock()
		v.hwnd = 0
		destroyRenderer := v.renderer
		destroyDecoder := v.decoder
		v.renderer = nil
		v.decoder = nil
		v.notification.cancel()
		v.mu.Unlock()
		if destroyRenderer != nil {
			destroyRenderer.close()
		}
		if destroyDecoder != nil {
			destroyDecoder.close()
		}
		v.logger.event("VIEWER_CLOSE")
		postQuitMessage.Call(0)
		return 0
	case wmSize:
		v.mu.RLock()
		renderer := v.renderer
		v.mu.RUnlock()
		if renderer != nil {
			var client rect
			getClientRect.Call(hwnd, uintptr(unsafe.Pointer(&client)))
			if err := renderer.resize(int(client.Right), int(client.Bottom)); err != nil {
				v.logger.event("VIEWER_D3D11_RESIZE_FAILED")
			}
		}
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
		v.notification.consume()
		closed := v.sessionClosed
		v.mu.Unlock()
		if !closed {
			v.presentLatestFrame(hwnd)
		}
		return 0
	case wmTimer:
		if wparam == framePresentTimer {
			v.presentLatestFrame(hwnd)
			v.mu.Lock()
			hasFrame := len(v.frame.pixels) != 0
			animate := !hasFrame && time.Since(v.lastLoadingInvalidate) >= time.Second/30
			if animate {
				v.lastLoadingInvalidate = time.Now()
			}
			v.mu.Unlock()
			if animate {
				invalidateRect.Call(hwnd, 0, 0, 0)
			}
		}
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
		v.queueInput(rdp.Input{Type: "mouse_wheel", Delta: int(int16(wparam >> 16))})
	case wmKeyDown:
		v.queueInput(rdp.Input{Type: "key_down", VK: uint16(wparam)})
	case wmKeyUp:
		v.queueInput(rdp.Input{Type: "key_up", VK: uint16(wparam)})
	}
	value, _, _ := defWindowProc.Call(hwnd, uintptr(message), wparam, lparam)
	return value
}
func (v *viewer) sendMouse(hwnd uintptr, kind, button string, delta int, lparam uintptr) {
	x, y, ok := v.mapMouse(hwnd, int(int16(lparam)), int(int16(lparam>>16)))
	if !ok {
		return
	}
	v.queueInput(rdp.Input{Type: kind, X: x, Y: y, Button: button, Delta: delta})
}
func (v *viewer) mapMouse(hwnd uintptr, x, y int) (int, int, bool) {
	v.mu.RLock()
	frame := v.frame
	v.mu.RUnlock()
	var client rect
	getClientRect.Call(hwnd, uintptr(unsafe.Pointer(&client)))
	return mapClientPoint(int(client.Right), int(client.Bottom), frame.width, frame.height, x, y)
}

// presentLatestFrame is invoked only by the window procedure on the UI thread.
// Unlike BeginPaint, GetDC is not clipped to an update region, so a new decoded
// frame is presented even when Windows has no pending WM_PAINT invalidation.
func (v *viewer) presentLatestFrame(hwnd uintptr) {
	v.mu.Lock()
	frame, generation, renderer := v.frame, v.frameGeneration, v.renderer
	if !v.notification.shouldPresent(generation) {
		v.mu.Unlock()
		return
	}
	v.notification.markAttempted(generation)
	v.mu.Unlock()
	if renderer != nil {
		started := time.Now()
		err := renderer.renderFrame(frame)
		v.recordRendererResult(err, generation, time.Since(started))
		return
	}
	v.presentLatestFrameGDI(hwnd, frame, generation)
}
func (v *viewer) presentLatestFrameGDI(hwnd uintptr, frame viewerFrame, generation uint64) {
	hdc, _, _ := getWindowDC.Call(hwnd)
	if hdc == 0 {
		v.recordPaintResult(-1, 0, 0, 0, 0, generation)
		return
	}
	defer releaseWindowDC.Call(hwnd, hdc)
	var client rect
	getClientRect.Call(hwnd, uintptr(unsafe.Pointer(&client)))
	if !frame.valid() {
		v.recordPaintResult(0, frame.width, frame.height, int(client.Right), int(client.Bottom), generation)
		return
	}
	display, ok := fittedImageRect(int(client.Right), int(client.Bottom), frame.width, frame.height)
	if !ok {
		v.recordPaintResult(0, frame.width, frame.height, int(client.Right), int(client.Bottom), generation)
		return
	}
	info := bitmapInfo{Header: bitmapInfoHeader{Size: uint32(unsafe.Sizeof(bitmapInfoHeader{})), Width: int32(frame.width), Height: -int32(frame.height), Planes: 1, BitCount: 32, Compression: biRGB}}
	copied, _, _ := stretchDIBits.Call(hdc, uintptr(display.x), uintptr(display.y), uintptr(display.width), uintptr(display.height), 0, 0, uintptr(frame.width), uintptr(frame.height), uintptr(unsafe.Pointer(&frame.pixels[0])), uintptr(unsafe.Pointer(&info)), 0, 0x00cc0020)
	v.recordPaintResult(int32(copied), frame.width, frame.height, int(client.Right), int(client.Bottom), generation)
}
func (v *viewer) recordRendererResult(err error, generation uint64, elapsed time.Duration) {
	v.mu.Lock()
	v.presentAttempts++
	if err == nil {
		v.presentMetrics.add(elapsed)
		v.successfulPresents++
		v.lastSuccessfulGeneration = generation
		v.status = ""
	} else {
		v.gdiErrorPresents++
	}
	v.mu.Unlock()
	if err != nil {
		v.logger.event("VIEWER_D3D11_PRESENT_FAILED")
	}
}
func (v *viewer) paint(hwnd uintptr) {
	var paint paintStruct
	hdc, _, _ := beginPaint.Call(hwnd, uintptr(unsafe.Pointer(&paint)))
	if hdc == 0 {
		return
	}
	defer endPaint.Call(hwnd, uintptr(unsafe.Pointer(&paint)))
	v.mu.RLock()
	renderer, status, hasFrame := v.renderer, v.status, len(v.frame.pixels) != 0
	v.mu.RUnlock()
	if renderer != nil && hasFrame {
		if err := renderer.redraw(); err != nil {
			v.logger.event("VIEWER_D3D11_REDRAW_FAILED")
		}
		return
	}
	var client rect
	getClientRect.Call(hwnd, uintptr(unsafe.Pointer(&client)))
	fillRect.Call(hdc, uintptr(unsafe.Pointer(&client)), getStockObjectValue(blackBrush))
	if !hasFrame {
		v.paintStatus(hdc, client, status)
	}
}
func (v *viewer) recordExposureResult(result int32, width, height, clientWidth, clientHeight int, generation uint64) {
}

func (v *viewer) recordPaintResult(result int32, width, height, clientWidth, clientHeight int, generation uint64) {
	success := result > 0
	v.mu.Lock()
	v.presentAttempts++
	if success {
		v.successfulPresents++
		v.lastSuccessfulGeneration = generation
	} else if result < 0 {
		v.gdiErrorPresents++
	} else {
		v.zeroResultPresents++
	}
	logResult := false
	if success {
		unique := v.paintState.record(generation)
		paintEvents, uniquePainted := v.paintState.paintEvents, v.paintState.uniqueFramesPainted
		if !v.paintLogged {
			v.paintLogged = true
			logResult = true
		}
		v.paintFailureLogged = false
		v.status = ""
		v.mu.Unlock()
		if logResult {
			v.logger.event(fmt.Sprintf("VIEWER_PAINT_RESULT result=%d width=%d height=%d client_width=%d client_height=%d frame_generation=%d", result, width, height, clientWidth, clientHeight, generation))
		}
		if unique && uniquePainted%120 == 0 {
			v.logger.event(fmt.Sprintf("VIEWER_PAINT_STATS paint_events=%d unique_frames_painted=%d", paintEvents, uniquePainted))
		}
		return
	}
	if !v.paintFailureLogged {
		v.paintFailureLogged = true
		logResult = true
	}
	v.mu.Unlock()
	if logResult {
		v.logger.event(fmt.Sprintf("VIEWER_PAINT_RESULT result=%d width=%d height=%d client_width=%d client_height=%d frame_generation=%d", result, width, height, clientWidth, clientHeight, generation))
	}
}
func (v *viewer) logPresentStats(decodedGeneration uint64, presentedFPS float64) {
	v.mu.RLock()
	attempts, successful := v.presentAttempts, v.successfulPresents
	zero, failed, lastSuccessful := v.zeroResultPresents, v.gdiErrorPresents, v.lastSuccessfulGeneration
	backend, renderer, present := v.rendererBackend, v.renderer, v.presentMetrics.snapshot()
	v.mu.RUnlock()
	rendererStats := nativeRendererStats{}
	if renderer != nil {
		rendererStats = renderer.snapshot()
	}
	avg, p50, p95, max := milliseconds(present)
	v.logger.event(fmt.Sprintf("VIEWER_RENDER_STATS backend=%s decoded_generation=%d render_attempts=%d successful_presents=%d failed_presents=%d last_successful_generation=%d presented_fps=%.1f present_ms=avg:%.1f/p50:%.1f/p95:%.1f/max:%.1f device_resets=%d", backend, decodedGeneration, attempts, successful, zero+failed, lastSuccessful, presentedFPS, avg, p50, p95, max, rendererStats.DeviceResets))
}
func rgb(red, green, blue byte) uintptr { return uintptr(red) | uintptr(green)<<8 | uintptr(blue)<<16 }

func fillStatusRect(hdc uintptr, area rect, color uintptr) {
	brush, _, _ := createSolidBrush.Call(color)
	if brush == 0 {
		return
	}
	defer deleteObject.Call(brush)
	fillRect.Call(hdc, uintptr(unsafe.Pointer(&area)), brush)
}

func statusFont(height, weight int32) uintptr {
	name, _ := syscall.UTF16PtrFromString("Segoe UI")
	font, _, _ := createFont.Call(uintptr(height), 0, 0, 0, uintptr(weight), 0, 0, 0, 1, 0, 0, 0, 0, uintptr(unsafe.Pointer(name)))
	return font
}

func drawStatusText(hdc uintptr, text string, area rect, color uintptr, height, weight int32) {
	value, _ := syscall.UTF16PtrFromString(text)
	font := statusFont(height, weight)
	if font != 0 {
		previous, _, _ := selectObject.Call(hdc, font)
		defer func() {
			selectObject.Call(hdc, previous)
			deleteObject.Call(font)
		}()
	}
	setTextColor.Call(hdc, color)
	drawText.Call(hdc, uintptr(unsafe.Pointer(value)), ^uintptr(0), uintptr(unsafe.Pointer(&area)), dtLeft|dtVCenter|dtSingleLine|dtEndEllipsis)
}

func fillStatusEllipse(hdc uintptr, area rect, color uintptr) {
	brush, _, _ := createSolidBrush.Call(color)
	if brush == 0 {
		return
	}
	previous, _, _ := selectObject.Call(hdc, getStockObjectValue(8))
	defer func() {
		selectObject.Call(hdc, previous)
		deleteObject.Call(brush)
	}()
	selectObject.Call(hdc, brush)
	ellipse.Call(hdc, uintptr(area.Left), uintptr(area.Top), uintptr(area.Right), uintptr(area.Bottom))
}

func drawStatusMark(hdc uintptr, x, y int32) {
	outer := [...]point{{x + 34, y}, {x + 68, y + 20}, {x + 68, y + 57}, {x + 34, y + 78}, {x, y + 57}, {x, y + 20}}
	inner := [...]point{{x + 34, y + 9}, {x + 59, y + 24}, {x + 59, y + 52}, {x + 34, y + 67}, {x + 9, y + 52}, {x + 9, y + 24}}
	brush, _, _ := createSolidBrush.Call(rgb(0, 174, 239))
	if brush == 0 {
		return
	}
	previous, _, _ := selectObject.Call(hdc, brush)
	polygon.Call(hdc, uintptr(unsafe.Pointer(&outer[0])), uintptr(len(outer)))
	selectObject.Call(hdc, previous)
	deleteObject.Call(brush)
	brush, _, _ = createSolidBrush.Call(rgb(5, 10, 16))
	if brush == 0 {
		return
	}
	previous, _, _ = selectObject.Call(hdc, brush)
	polygon.Call(hdc, uintptr(unsafe.Pointer(&inner[0])), uintptr(len(inner)))
	selectObject.Call(hdc, previous)
	deleteObject.Call(brush)
	fillStatusEllipse(hdc, rect{Left: x + 29, Top: y + 31, Right: x + 39, Bottom: y + 41}, rgb(103, 218, 255))
}

func drawCenteredStatusText(hdc uintptr, text string, area rect, color uintptr, height, weight int32) {
	value, _ := syscall.UTF16PtrFromString(text)
	font := statusFont(height, weight)
	if font != 0 {
		previous, _, _ := selectObject.Call(hdc, font)
		defer func() {
			selectObject.Call(hdc, previous)
			deleteObject.Call(font)
		}()
	}
	setTextColor.Call(hdc, color)
	drawText.Call(hdc, uintptr(unsafe.Pointer(value)), ^uintptr(0), uintptr(unsafe.Pointer(&area)), dtCenter|dtVCenter|dtSingleLine|dtEndEllipsis)
}

func (v *viewer) paintStatus(hdc uintptr, client rect, status string) {
	if status == "" {
		status = "Connecting to remote device..."
	}
	v.mu.RLock()
	started := v.loadingAnimationStarted
	v.mu.RUnlock()
	if started.IsZero() {
		started = time.Now()
	}
	elapsed := time.Since(started)
	animationStep := int(elapsed / (time.Second / 30))
	dotPhase := animationStep / 8

	fillStatusRect(hdc, client, rgb(5, 10, 16))
	centerX, centerY := (client.Left+client.Right)/2, (client.Top+client.Bottom)/2
	for i := int32(0); i < 7; i++ {
		radius := int32(260) - i*34
		shade := byte(11 + i*2)
		fillStatusEllipse(hdc, rect{Left: centerX - radius, Top: centerY - radius, Right: centerX + radius, Bottom: centerY + radius}, rgb(4, shade, shade+8))
	}

	logoX, logoY := centerX-34, centerY-112
	drawStatusMark(hdc, logoX, logoY)
	for dot := 0; dot < 3; dot++ {
		active := (dotPhase % 3) == dot
		color := rgb(37, 114, 146)
		if active {
			color = rgb(0, 174, 239)
		}
		x := centerX - 16 + int32(dot)*16
		fillStatusEllipse(hdc, rect{Left: x - 3, Top: logoY + 91, Right: x + 3, Bottom: logoY + 97}, color)
	}

	textWidth := int32(420)
	textArea := rect{Left: centerX - textWidth/2, Top: logoY + 119, Right: centerX + textWidth/2, Bottom: logoY + 150}
	drawCenteredStatusText(hdc, "SentinelGrid Remote", textArea, rgb(245, 247, 250), 22, fontWeightSemiBold)
	statusArea := rect{Left: centerX - textWidth/2, Top: logoY + 158, Right: centerX + textWidth/2, Bottom: logoY + 182}
	drawCenteredStatusText(hdc, status, statusArea, rgb(127, 140, 153), 14, fontWeightNormal)

	trackWidth, trackHeight := int32(184), int32(2)
	track := rect{Left: centerX - trackWidth/2, Top: logoY + 199, Right: centerX + trackWidth/2, Bottom: logoY + 199 + trackHeight}
	fillStatusRect(hdc, track, rgb(18, 37, 51))
	highlightWidth := int32(54)
	offset := int32(animationStep%90)*(trackWidth+highlightWidth)/90 - highlightWidth
	fillStatusRect(hdc, rect{Left: track.Left + offset, Top: track.Top, Right: track.Left + offset + highlightWidth, Bottom: track.Bottom}, rgb(0, 174, 239))

	footer := rect{Left: centerX - textWidth/2, Top: client.Bottom - 38, Right: centerX + textWidth/2, Bottom: client.Bottom - 16}
	drawCenteredStatusText(hdc, "Secure remote connection • SentinelGrid", footer, rgb(101, 117, 130), 12, fontWeightNormal)
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
