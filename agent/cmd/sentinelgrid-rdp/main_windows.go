//go:build windows

package main

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/png"
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
	wmDestroy            = 0x0002
	wmPaint              = 0x000f
	wmSize               = 0x0005
	wmEraseBkgnd         = 0x0014
	wmSetFocus           = 0x0007
	wmClose              = 0x0010
	wmMouseMove          = 0x0200
	wmLButtonDown        = 0x0201
	wmLButtonUp          = 0x0202
	wmRButtonDown        = 0x0204
	wmRButtonUp          = 0x0205
	wmMButtonDown        = 0x0207
	wmMButtonUp          = 0x0208
	wmMouseWheel         = 0x020a
	wmKeyDown            = 0x0100
	wmKeyUp              = 0x0101
	wmSysKeyDown         = 0x0104
	wmSysKeyUp           = 0x0105
	wmKillFocus          = 0x0008
	wmActivateApp        = 0x001c
	wmFrameReady         = 0x8001
	wmStateChanged       = 0x8002
	wmTimer              = 0x0113
	wmSetIcon            = 0x0080
	framePresentTimer    = 1
	framePresentPeriod   = 16
	wsOverlappedWindow   = 0x00cf0000
	wsChild              = 0x40000000
	wsVisible            = 0x10000000
	csHRedraw            = 0x0002
	csVRedraw            = 0x0001
	swShow               = 5
	biRGB                = 0
	blackBrush           = 4
	transparent          = 1
	imageIcon            = 1
	lrDefaultSize        = 0x0040
	iconSmall            = 0
	iconBig              = 1
	sentinelGridInputTag = 0x5347494E
	psSolid              = 0
	dtLeft               = 0x00000000
	dtCenter             = 0x00000001
	dtVCenter            = 0x00000004
	dtSingleLine         = 0x00000020
	dtEndEllipsis        = 0x00008000
	fontWeightNormal     = 400
	fontWeightSemiBold   = 600
	fontWeightBold       = 700
)

type viewer struct {
	mu                         sync.RWMutex
	writeMu                    sync.Mutex
	ws                         *websocket.Conn
	frame                      viewerFrame
	frameGeneration            uint64
	hwnd                       uintptr
	videoHost                  uintptr
	shell                      viewerShellLayout
	scaleMode                  viewerScaleMode
	showStats                  bool
	hoverAction, pressedAction string
	shutdownOnce               sync.Once
	shutdownDone               chan struct{}
	fullscreen                 bool
	shellTransition            bool
	lastStatsInvalidate        time.Time
	restorePlacement           windowPlacement
	restoreStyle               uintptr
	status                     string
	sessionState               viewerSessionState
	logger                     *viewerLogger
	compressed                 *latestCompressedFrame
	closeRequested             bool
	sessionClosed              bool
	done                       chan struct{}
	renderer                   *nativeRenderer
	rendererBackend            string
	decoder                    *nativeH264Decoder
	videoCodec                 string
	screenWidth, screenHeight  int
	lastKeyframeRequest        time.Time
	input                      *viewerInputSender
	inputMode                  string
	blockLocalInput            bool
	showRemoteCursor           bool

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
var getMessageExtraInfo = viewerUser32.NewProc("GetMessageExtraInfo")
var loadImage = viewerUser32.NewProc("LoadImageW")
var sendMessage = viewerUser32.NewProc("SendMessageW")
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
var roundRect = viewerGDI32.NewProc("RoundRect")

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
	v := &viewer{logger: logger, status: "Connecting to remote device...", sessionState: viewerStateConnecting, done: make(chan struct{}), statsStarted: started, statsReported: started, compressed: newLatestCompressedFrame(), decodeMetrics: newDurationWindow(120), conversionMetrics: newDurationWindow(120), bufferCopyMetrics: newDurationWindow(120), presentMetrics: newDurationWindow(120), loadingAnimationStarted: started, inputMode: "full", showRemoteCursor: true}
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
		if v.closeRequested {
			v.mu.Unlock()
			_ = ws.Close()
			return
		}
		v.ws = ws
		v.mu.Unlock()
		v.logger.event("VIEWER_RELAY_CONNECTED")
		if err := v.sendInputControl(); err != nil {
			v.logger.event("VIEWER_INPUT_CONTROL_SEND_FAILED stage=initial")
		}
		v.setSessionState(viewerStateNegotiatingVideo)
		decodeDone := make(chan struct{})
		go func() { defer close(decodeDone); v.decodeFrames() }()
		v.receive()
		v.compressed.close()
		<-decodeDone
		v.mu.Lock()
		decoder := v.decoder
		v.decoder = nil
		v.mu.Unlock()
		if decoder != nil {
			decoder.close()
		}
	}()
	windowErr := v.window()
	cancelSession()
	v.beginShutdown()
	select {
	case <-v.done:
	case <-time.After(2 * time.Second):
		logger.event("VIEWER_RELAY_CLOSE_WAIT_TIMEOUT")
	}
	if v.shutdownDone != nil {
		select {
		case <-v.shutdownDone:
		case <-time.After(2 * time.Second):
			logger.event("VIEWER_INPUT_CLOSE_WAIT_TIMEOUT")
		}
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

func (v *viewer) setSessionState(state viewerSessionState) {
	v.mu.Lock()
	if !v.sessionState.canTransition(state) {
		v.mu.Unlock()
		return
	}
	v.sessionState = state
	if state == viewerStateConnected || state.terminal() || state == viewerStateDisconnecting {
		v.status = ""
	}
	hwnd := v.hwnd
	v.mu.Unlock()
	if hwnd != 0 {
		postMessage.Call(hwnd, wmStateChanged, 0, 0)
	}
}

func (v *viewer) fail(status string) {
	v.logger.event("VIEWER_SESSION_FAILED")
	v.setStatus(status)
	v.setSessionState(viewerStateConnectionLost)
}

func (v *viewer) requestClose() {
	v.mu.Lock()
	v.closeRequested = true
	v.sessionState = viewerStateDisconnecting
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
				code := 0
				var closeErr *websocket.CloseError
				if errors.As(err, &closeErr) {
					code = closeErr.Code
				}
				v.logger.event(fmt.Sprintf("VIEWER_RELAY_CLOSED category=%s code=%d", relayCloseCategory(err), code))
			}
			v.mu.Lock()
			v.sessionClosed = true
			v.sessionState = viewerTerminalState(v.closeRequested, relayCloseCategory(err))
			hwnd := v.hwnd
			v.notification.cancel()
			v.mu.Unlock()
			_ = ws.Close()
			v.compressed.close()
			if v.input != nil {
				v.input.releaseOnFocusLoss()
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
	return v.ws != nil && !v.sessionClosed && v.sessionState == viewerStateConnected && v.inputMode == "full"
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

func (v *viewer) sendInputControl() error {
	v.mu.RLock()
	settings := rdp.InputControl{Mode: v.inputMode, BlockLocalInput: v.blockLocalInput, ShowRemoteCursor: v.showRemoteCursor}
	ws := v.ws
	closed := v.sessionClosed || v.closeRequested
	v.mu.RUnlock()
	if ws == nil || closed {
		return errors.New("viewer input control session is closed")
	}
	data, err := json.Marshal(settings)
	if err != nil {
		return err
	}
	v.writeMu.Lock()
	defer v.writeMu.Unlock()
	return rdp.WritePacket(ws, append([]byte{rdp.PacketInputControl}, data...))
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
	closed := v.sessionClosed || ((v.closeRequested || v.sessionState.terminal()) && input.Type != "key_up" && input.Type != "mouse_up")
	v.mu.RUnlock()
	if ws == nil || closed {
		return errors.New("viewer input session is closed")
	}
	return rdp.WritePacket(ws, packet)
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
	icon, _, _ := loadImage.Call(instance, 1, imageIcon, 0, 0, lrDefaultSize)
	wc := wndClassEx{
		Size:       uint32(unsafe.Sizeof(wndClassEx{})),
		Style:      csHRedraw | csVRedraw,
		WndProc:    callback,
		Instance:   instance,
		Icon:       icon,
		ClassName:  class,
		IconSmall:  icon,
		Background: getStockObjectValue(blackBrush),
	}
	if atom, _, err := registerClassEx.Call(uintptr(unsafe.Pointer(&wc))); atom == 0 {
		v.logger.event(fmt.Sprintf("VIEWER_WINDOW_FAILED stage=register_class error=%s", win32Error(err)))
		return fmt.Errorf("could not register viewer window: %s", win32Error(err))
	}
	v.logger.event("VIEWER_REGISTER_CLASS_OK")
	hwnd, _, err := createWindowEx.Call(0, uintptr(unsafe.Pointer(class)), uintptr(unsafe.Pointer(title)), wsOverlappedWindow|0x02000000, 100, 100, 1280, 800, 0, 0, instance, 0)
	if hwnd == 0 {
		v.logger.event(fmt.Sprintf("VIEWER_WINDOW_FAILED stage=create_window error=%s", win32Error(err)))
		return fmt.Errorf("could not create viewer window: %s", win32Error(err))
	}
	defer viewerUser32.NewProc("DestroyWindow").Call(hwnd)
	v.logger.event("VIEWER_WINDOW_CREATED")
	if icon != 0 {
		sendMessage.Call(hwnd, wmSetIcon, iconSmall, icon)
		sendMessage.Call(hwnd, wmSetIcon, iconBig, icon)
	}
	v.applyWindowChrome(hwnd)
	videoClass, _ := syscall.UTF16PtrFromString("SentinelGridRemoteVideoHost")
	videoCallback := syscall.NewCallback(videoHostProc)
	videoWC := wndClassEx{Size: uint32(unsafe.Sizeof(wndClassEx{})), Style: csHRedraw | csVRedraw, WndProc: videoCallback, Instance: instance, ClassName: videoClass, Background: getStockObjectValue(blackBrush)}
	if atom, _, classErr := registerClassEx.Call(uintptr(unsafe.Pointer(&videoWC))); atom == 0 {
		return fmt.Errorf("could not register video host class: %s", win32Error(classErr))
	}
	videoHost, _, videoErr := createWindowEx.Call(0, uintptr(unsafe.Pointer(videoClass)), 0, wsChild|wsVisible, 0, 0, 1, 1, hwnd, 0, instance, 0)
	if videoHost == 0 {
		return fmt.Errorf("could not create video host: %s", win32Error(videoErr))
	}
	v.mu.Lock()
	v.hwnd, v.videoHost = hwnd, videoHost
	v.mu.Unlock()
	v.layoutShell(hwnd)
	if renderer, rendererErr := newNativeRenderer(videoHost); rendererErr == nil {
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
	if v.localShellKey(message, wparam, lparam) {
		return 0
	}
	switch message {
	case wmClose:
		v.logger.event("VIEWER_CLOSE_REQUESTED")
		v.beginShutdown()
	case wmDestroy:
		killTimer.Call(hwnd, framePresentTimer)
		v.mu.Lock()
		v.hwnd = 0
		v.videoHost = 0
		destroyRenderer := v.renderer
		v.renderer = nil
		v.notification.cancel()
		v.mu.Unlock()
		if destroyRenderer != nil {
			destroyRenderer.close()
		}
		v.logger.event("VIEWER_CLOSE")
		postQuitMessage.Call(0)
		return 0
	case wmSize:
		v.mu.RLock()
		transition := v.shellTransition
		v.mu.RUnlock()
		if !transition {
			v.layoutShell(hwnd)
		}
		return 0
	case wmSetFocus:
		setFocus.Call(v.presentationHWND())
	case wmKillFocus:
		if v.input != nil {
			v.input.releaseOnFocusLoss()
		}
	case wmActivateApp:
		if wparam == 0 && v.input != nil {
			v.input.releaseOnFocusLoss()
		}
	case wmEraseBkgnd:
		return 1
	case wmFrameReady:
		v.mu.Lock()
		v.notification.consume()
		closed := v.sessionClosed
		v.mu.Unlock()
		if !closed {
			v.presentLatestFrame(v.presentationHWND())
		}
		return 0
	case wmTimer:
		if wparam == framePresentTimer {
			v.presentLatestFrame(v.presentationHWND())
			v.mu.Lock()
			refreshStats := v.showStats && time.Since(v.lastStatsInvalidate) >= time.Second
			if refreshStats {
				v.lastStatsInvalidate = time.Now()
			}
			hasFrame := len(v.frame.pixels) != 0
			animate := !hasFrame && time.Since(v.lastLoadingInvalidate) >= time.Second/30
			if animate {
				v.lastLoadingInvalidate = time.Now()
			}
			v.mu.Unlock()
			if refreshStats {
				invalidateRect.Call(hwnd, 0, 0, 0)
			}
			if animate {
				invalidateRect.Call(v.presentationHWND(), 0, 0, 0)
			}
		}
		return 0
	case wmStateChanged:
		invalidateRect.Call(hwnd, 0, 0, 0)
		invalidateRect.Call(v.presentationHWND(), 0, 0, 0)
		return 0
	case wmPaint:
		v.paintToolbar(hwnd)
		return 0
	case wmMouseMove, wmLButtonDown, wmLButtonUp, wmMouseLeave, wmCaptureChanged:
		if v.handleShellPointer(hwnd, message, lparam) {
			return 0
		}
	case wmKeyDown:
		if wparam == 27 {
			v.mu.RLock()
			fullscreen := v.fullscreen
			v.mu.RUnlock()
			if fullscreen {
				v.toggleFullscreen()
				return 0
			}
		}
	}
	value, _, _ := defWindowProc.Call(hwnd, uintptr(message), wparam, lparam)
	return value
}
func viewerMessageIsInjected() bool {
	value, _, _ := getMessageExtraInfo.Call()
	return isSentinelGridInputTag(value)
}
func isSentinelGridInputTag(value uintptr) bool { return value == sentinelGridInputTag }
func keyboardInput(kind string, wparam, lparam uintptr) rdp.Input {
	return rdp.Input{Type: kind, VK: uint16(wparam), Scan: uint16((lparam >> 16) & 0xff), Extended: lparam&(1<<24) != 0}
}
func (v *viewer) sendMouse(hwnd uintptr, kind, button string, delta int, lparam uintptr) {
	x, y, ok := v.mapMouse(hwnd, int(int16(lparam)), int(int16(lparam>>16)))
	if !ok {
		return
	}
	v.queueInput(rdp.Input{Type: kind, X: x, Y: y, Button: button, Delta: delta})
}
func (v *viewer) presentationHWND() uintptr { v.mu.RLock(); defer v.mu.RUnlock(); return v.videoHost }
func (v *viewer) mapMouse(hwnd uintptr, x, y int) (int, int, bool) {
	if hwnd == 0 || hwnd != v.presentationHWND() {
		return 0, 0, false
	}
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
	if hwnd == 0 || v.sessionClosed || v.closeRequested || (v.sessionState != viewerStateNegotiatingVideo && v.sessionState != viewerStateConnected) || !v.notification.shouldPresent(generation) {
		v.mu.Unlock()
		return
	}
	var client rect
	getClientRect.Call(hwnd, uintptr(unsafe.Pointer(&client)))
	if client.Right <= 0 || client.Bottom <= 0 {
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
	connected := false
	if err == nil {
		v.presentMetrics.add(elapsed)
		v.successfulPresents++
		v.lastSuccessfulGeneration = generation
		if v.sessionState == viewerStateNegotiatingVideo {
			v.sessionState = viewerStateConnected
			connected = true
		}
		v.status = ""
	} else {
		v.gdiErrorPresents++
	}
	hwnd := v.hwnd
	v.mu.Unlock()
	if connected && hwnd != 0 {
		postMessage.Call(hwnd, wmStateChanged, 0, 0)
	}
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
	renderer, status, state, hasFrame := v.renderer, v.status, v.sessionState, len(v.frame.pixels) != 0
	v.mu.RUnlock()
	var client rect
	getClientRect.Call(hwnd, uintptr(unsafe.Pointer(&client)))
	if state.terminal() {
		v.paintTerminalStatus(hdc, client, state)
		return
	}
	if renderer != nil && hasFrame && state == viewerStateConnected {
		if err := renderer.redraw(); err != nil {
			v.logger.event("VIEWER_D3D11_REDRAW_FAILED")
		}
		return
	}
	fillRect.Call(hdc, uintptr(unsafe.Pointer(&client)), getStockObjectValue(blackBrush))
	if state != viewerStateConnected {
		v.paintStatus(hdc, client, status)
	} else if hasFrame {
		v.mu.RLock()
		frame, generation := v.frame, v.frameGeneration
		v.mu.RUnlock()
		v.presentLatestFrameGDI(hwnd, frame, generation)
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
		connected := false
		unique := v.paintState.record(generation)
		paintEvents, uniquePainted := v.paintState.paintEvents, v.paintState.uniqueFramesPainted
		if v.sessionState == viewerStateNegotiatingVideo {
			v.sessionState = viewerStateConnected
			connected = true
		}
		if !v.paintLogged {
			v.paintLogged = true
			logResult = true
		}
		v.paintFailureLogged = false
		v.status = ""
		hwnd := v.hwnd
		v.mu.Unlock()
		if connected && hwnd != 0 {
			postMessage.Call(hwnd, wmStateChanged, 0, 0)
		}
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
	setBkMode.Call(hdc, 1) // TRANSPARENT
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

//go:embed sentinelgrid-mark.png
var sentinelGridMarkPNG []byte

var sentinelGridMark image.Image

func init() {
	mark, _, err := image.Decode(bytes.NewReader(sentinelGridMarkPNG))
	if err == nil {
		sentinelGridMark = mark
	}
}

func drawStatusMark(hdc uintptr, x, y, size int32, background uintptr) {
	if size < 12 || sentinelGridMark == nil {
		return
	}
	bounds := sentinelGridMark.Bounds()
	height := size * int32(bounds.Dy()) / int32(bounds.Dx())
	pixels := make([]byte, size*height*4)
	backR, backG, backB := uint32(background&0xff), uint32((background>>8)&0xff), uint32((background>>16)&0xff)
	for dy := int32(0); dy < height; dy++ {
		sy := bounds.Min.Y + int(dy)*bounds.Dy()/int(height)
		for dx := int32(0); dx < size; dx++ {
			sx := bounds.Min.X + int(dx)*bounds.Dx()/int(size)
			r, g, b, a := sentinelGridMark.At(sx, sy).RGBA()
			alpha := uint32(a)
			r8 := (uint32(r)*alpha/65535 + backR*(65535-alpha)) / 65535
			g8 := (uint32(g)*alpha/65535 + backG*(65535-alpha)) / 65535
			b8 := (uint32(b)*alpha/65535 + backB*(65535-alpha)) / 65535
			offset := (dy*size + dx) * 4
			pixels[offset], pixels[offset+1], pixels[offset+2], pixels[offset+3] = byte(b8), byte(g8), byte(r8), 0xff
		}
	}
	info := bitmapInfo{Header: bitmapInfoHeader{Size: uint32(unsafe.Sizeof(bitmapInfoHeader{})), Width: size, Height: -height, Planes: 1, BitCount: 32, Compression: biRGB}}
	stretchDIBits.Call(hdc, uintptr(x), uintptr(y), uintptr(size), uintptr(height), 0, 0, uintptr(size), uintptr(height), uintptr(unsafe.Pointer(&pixels[0])), uintptr(unsafe.Pointer(&info)), 0, 0x00cc0020)
}
func drawCenteredStatusText(hdc uintptr, text string, area rect, color uintptr, height, weight int32) {
	value, _ := syscall.UTF16PtrFromString(text)
	font := statusFont(height, weight)
	if font != 0 {
		previous, _, _ := selectObject.Call(hdc, font)
		defer func() { selectObject.Call(hdc, previous); deleteObject.Call(font) }()
	}
	setTextColor.Call(hdc, color)
	setBkMode.Call(hdc, 1) // TRANSPARENT
	drawText.Call(hdc, uintptr(unsafe.Pointer(value)), ^uintptr(0), uintptr(unsafe.Pointer(&area)), dtCenter|dtVCenter|dtSingleLine|dtEndEllipsis)
}

func drawStatusRoundRect(hdc uintptr, area rect, radius int32, fill, border uintptr) {
	brush, _, _ := createSolidBrush.Call(fill)
	pen, _, _ := createPen.Call(0, 1, border)
	if brush == 0 || pen == 0 {
		if brush != 0 {
			deleteObject.Call(brush)
		}
		if pen != 0 {
			deleteObject.Call(pen)
		}
		return
	}
	oldBrush, _, _ := selectObject.Call(hdc, brush)
	oldPen, _, _ := selectObject.Call(hdc, pen)
	roundRect.Call(hdc, uintptr(area.Left), uintptr(area.Top), uintptr(area.Right), uintptr(area.Bottom), uintptr(radius), uintptr(radius))
	selectObject.Call(hdc, oldPen)
	selectObject.Call(hdc, oldBrush)
	deleteObject.Call(pen)
	deleteObject.Call(brush)
}

func loadingStatusLabel(status string) string {
	switch status {
	case "Negotiating video...", "Starting remote display...":
		return "Starting video"
	case "Establishing secure session...":
		return "Securing session"
	default:
		return "Connecting"
	}
}

func clampStatus(value, low, high int32) int32 {
	if value < low {
		return low
	}
	if value > high {
		return high
	}
	return value
}

func (v *viewer) paintStatus(hdc uintptr, client rect, status string) {
	if status == "" {
		status = "Connecting to remote device..."
	}

	fillStatusRect(hdc, client, rgb(7, 9, 12))

	v.mu.RLock()
	state := v.sessionState
	started := v.loadingAnimationStarted
	v.mu.RUnlock()

	stageLabel := loadingStatusLabel(status)
	stageColor := rgb(96, 165, 250)
	secureColor := rgb(96, 165, 250)
	videoColor := rgb(91, 98, 111)
	controlColor := rgb(91, 98, 111)

	if state == viewerStateNegotiatingVideo {
		stageLabel = "Starting video"
		stageColor = rgb(96, 165, 250)
		secureColor = rgb(130, 201, 167)
		videoColor = rgb(96, 165, 250)
		status = "Secure session established. Waiting for the first video frame..."
	}

	cardWidth := int32(min(560, max(0, int(client.Right)-48)))
	cardHeight := int32(min(306, max(220, int(client.Bottom)-32)))
	card := rect{
		Left:   (client.Right - cardWidth) / 2,
		Top:    (client.Bottom - cardHeight) / 2,
		Right:  (client.Right + cardWidth) / 2,
		Bottom: (client.Bottom + cardHeight) / 2,
	}

	drawStatusRoundRect(hdc, card, 22, rgb(13, 15, 18), rgb(39, 45, 54))

	// Product identity and current connection phase.
	drawStatusMark(hdc, card.Left+28, card.Top+25, 32, rgb(13, 15, 18))
	drawStatusText(
		hdc,
		"SentinelGrid Remote",
		rect{Left: card.Left + 72, Top: card.Top + 23, Right: card.Right - 170, Bottom: card.Top + 54},
		rgb(244, 245, 247),
		16,
		fontWeightSemiBold,
	)
	chip := rect{Left: card.Right - 150, Top: card.Top + 25, Right: card.Right - 28, Bottom: card.Top + 53}
	drawStatusRoundRect(hdc, chip, 14, rgb(10, 17, 27), rgb(43, 70, 106))
	fillStatusEllipse(hdc, rect{Left: chip.Left + 12, Top: chip.Top + 11, Right: chip.Left + 18, Bottom: chip.Top + 17}, stageColor)
	drawStatusText(hdc, stageLabel, rect{Left: chip.Left + 26, Top: chip.Top, Right: chip.Right - 8, Bottom: chip.Bottom}, stageColor, 12, fontWeightSemiBold)

	// Main connection message.
	drawStatusText(
		hdc,
		"Connecting to remote device",
		rect{Left: card.Left + 28, Top: card.Top + 82, Right: card.Right - 28, Bottom: card.Top + 112},
		rgb(244, 245, 247),
		21,
		fontWeightSemiBold,
	)
	drawStatusText(
		hdc,
		status,
		rect{Left: card.Left + 28, Top: card.Top + 116, Right: card.Right - 28, Bottom: card.Top + 142},
		rgb(160, 169, 181),
		12,
		fontWeightNormal,
	)

	// A subtle animated progress rail makes the wait feel active without inventing
	// a percentage that the transport cannot actually know.
	track := rect{Left: card.Left + 28, Top: card.Top + 156, Right: card.Right - 28, Bottom: card.Top + 162}
	drawStatusRoundRect(hdc, track, 6, rgb(24, 28, 34), rgb(24, 28, 34))
	if state == viewerStateNegotiatingVideo {
		progress := track
		progress.Right = progress.Left + (progress.Right-progress.Left)*7/10
		drawStatusRoundRect(hdc, progress, 6, rgb(74, 151, 119), rgb(74, 151, 119))
	} else {
		segmentWidth := int32(92)
		travel := (track.Right - track.Left) - segmentWidth
		offset := int32(0)
		if travel > 0 {
			offset = int32((time.Since(started).Milliseconds() / 5) % int64(travel))
		}
		segment := rect{Left: track.Left + offset, Top: track.Top, Right: track.Left + offset + segmentWidth, Bottom: track.Bottom}
		drawStatusRoundRect(hdc, segment, 6, rgb(58, 123, 213), rgb(58, 123, 213))
	}

	// Connection stages.
	type connectionStep struct {
		label  string
		detail string
		color  uintptr
	}
	steps := []connectionStep{
		{label: "Secure session", detail: "Authenticate relay", color: secureColor},
		{label: "Video stream", detail: "Prepare display", color: videoColor},
		{label: "Remote control", detail: "Enable input", color: controlColor},
	}
	contentWidth := card.Right - card.Left - 56
	columnWidth := contentWidth / 3
	for index, step := range steps {
		left := card.Left + 28 + int32(index)*columnWidth
		top := card.Top + 188
		fillStatusEllipse(hdc, rect{Left: left, Top: top + 5, Right: left + 9, Bottom: top + 14}, step.color)
		drawStatusText(hdc, step.label, rect{Left: left + 18, Top: top, Right: left + columnWidth - 6, Bottom: top + 22}, step.color, 12, fontWeightSemiBold)
		drawStatusText(hdc, step.detail, rect{Left: left + 18, Top: top + 24, Right: left + columnWidth - 6, Bottom: top + 45}, rgb(115, 123, 136), 11, fontWeightNormal)
		if index < 2 {
			lineLeft := left + columnWidth - 18
			fillStatusRect(hdc, rect{Left: lineLeft, Top: top + 9, Right: lineLeft + 12, Bottom: top + 10}, rgb(45, 51, 61))
		}
	}

	drawStatusText(
		hdc,
		"Controls become available as soon as the first remote frame is ready.",
		rect{Left: card.Left + 28, Top: card.Bottom - 44, Right: card.Right - 28, Bottom: card.Bottom - 20},
		rgb(104, 112, 124),
		11,
		fontWeightNormal,
	)
}

func main() {
	if len(os.Args) == 1 {
		installed, err := installRemoteViewer()
		showRemoteInstallResult(installed, err)
		if err != nil {
			log.Print("SentinelGrid Remote install/repair failed: ", err)
		}
		return
	}
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
