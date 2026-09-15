//go:build windows

package rdp

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/jpeg"
	"log"
	"os"
	"strings"
	"sync/atomic"
	"time"
	"unicode/utf16"
	"unsafe"

	"github.com/gorilla/websocket"
	"golang.org/x/sys/windows"
)

const createUnicodeEnvironment = 0x00000400

func LaunchInteractive(ctx context.Context, connection Connection) (launchErr error) {
	log.Print("[RDP] session received")
	session := windows.WTSGetActiveConsoleSessionId()
	if session == 0xffffffff {
		return fmt.Errorf("no active interactive Windows session")
	}
	log.Print("[RDP] interactive session detected")

	var token windows.Token
	if err := windows.WTSQueryUserToken(session, &token); err != nil {
		return fmt.Errorf("interactive user token unavailable: %w", err)
	}
	defer token.Close()

	var logger *remoteLogger
	if err := provisionRemoteLog(token); err != nil {
		log.Printf("[RDP] remote diagnostic log provisioning failed: %s", sanitizeRemoteLogError(err))
	} else if opened, err := openRemoteLogger(); err != nil {
		log.Printf("[RDP] remote diagnostic log unavailable: %s", sanitizeRemoteLogError(err))
	} else {
		logger = opened
		defer logger.close()
	}
	logger.event("REMOTE_LAUNCH_START")
	defer func() {
		if launchErr != nil {
			logger.event("REMOTE_LAUNCH_FAILED " + sanitizeRemoteLogError(launchErr))
		}
	}()
	logger.event(fmt.Sprintf("REMOTE_ACTIVE_SESSION %d", session))
	logger.event("REMOTE_USER_TOKEN_OK")
	if err := verifyRemoteLoggerAccess(token); err != nil {
		logger.event("REMOTE_CHILD_LOGGER_ACCESS_FAILED " + sanitizeRemoteLogError(err))
	} else {
		logger.event("REMOTE_CHILD_LOGGER_ACCESS_OK")
	}

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
	logger.event("REMOTE_EXECUTABLE_OK")

	desktop, err := windows.UTF16PtrFromString(`winsta0\default`)
	if err != nil {
		return err
	}
	env, err := remoteEnvironment(connection)
	if err != nil {
		return err
	}
	logger.event("REMOTE_ENV_READY")
	logger.event("REMOTE_LOG_PROVISIONED")

	startup := windows.StartupInfo{Cb: uint32(unsafe.Sizeof(windows.StartupInfo{})), Desktop: desktop}
	var process windows.ProcessInformation
	logger.event("REMOTE_CREATE_PROCESS_START")
	if err := windows.CreateProcessAsUser(token, app, &line[0], nil, nil, false, windows.CREATE_NO_WINDOW|createUnicodeEnvironment, &env[0], nil, &startup, &process); err != nil {
		wrapped := fmt.Errorf("could not start remote host in interactive session: %w", err)
		logger.event("REMOTE_CREATE_PROCESS_FAILED " + sanitizeRemoteLogError(wrapped))
		return wrapped
	}
	logger.event(fmt.Sprintf("REMOTE_PROCESS_CREATED %d", process.ProcessId))
	log.Print("[RDP] remote host launched")
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
			logger.event(fmt.Sprintf("REMOTE_PROCESS_EXIT %d %s", code, remoteHostExitReason(code)))
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

// remoteEnvironment returns a Windows double-NUL-terminated UTF-16 environment block.
func remoteEnvironment(c Connection) ([]uint16, error) {
	if err := c.Validate(); err != nil {
		return nil, err
	}
	values := make([]string, 0, len(os.Environ())+3)
	for _, value := range os.Environ() {
		if !strings.HasPrefix(value, "SENTINELGRID_REMOTE_") {
			values = append(values, value)
		}
	}
	values = append(values, "SENTINELGRID_REMOTE_RELAY="+c.Relay, "SENTINELGRID_REMOTE_TICKET="+c.Ticket, "SENTINELGRID_REMOTE_EXPIRES="+c.ExpiresAt.UTC().Format(time.RFC3339Nano))
	block := make([]uint16, 0, 2048)
	for _, value := range values {
		if strings.IndexByte(value, 0) >= 0 {
			return nil, fmt.Errorf("invalid environment value")
		}
		block = append(block, utf16.Encode([]rune(value))...)
		block = append(block, 0)
	}
	return append(block, 0), nil
}

func RunRemoteHost(ctx context.Context) (runErr error) {
	logger, loggerErr := openRemoteLogger()
	if loggerErr != nil {
		// Diagnostics must not prevent an authorized remote session.
		log.Printf("[RDP] remote diagnostic log unavailable: %s", sanitizeRemoteLogError(loggerErr))
	} else {
		defer logger.close()
		logger.event("REMOTE_HOST_START")
	}
	defer func() {
		if logger != nil {
			logger.event("REMOTE_HOST_EXIT " + sanitizeRemoteLogError(runErr))
		}
	}()
	return runRemoteHost(ctx, logger)
}

func runRemoteHost(ctx context.Context, logger *remoteLogger) error {
	connection := Connection{Relay: os.Getenv("SENTINELGRID_REMOTE_RELAY"), Ticket: os.Getenv("SENTINELGRID_REMOTE_TICKET")}
	if value, err := time.Parse(time.RFC3339Nano, os.Getenv("SENTINELGRID_REMOTE_EXPIRES")); err == nil {
		connection.ExpiresAt = value
	}
	if err := connection.Validate(); err != nil {
		return remoteHostFailure("environment", err)
	}
	ws, err := Dial(ctx, connection)
	if err != nil {
		return remoteHostFailure("relay", err)
	}
	defer ws.Close()
	backend, description, err := newPreferredCaptureBackendWithDiagnostics(ctx, logger.event)
	if err != nil {
		return remoteHostFailure("capture-backend", err)
	}
	defer backend.Close()
	logger.event("REMOTE_VIDEO_BACKEND backend=" + description)
	width, height := backend.Dimensions()
	if err := sendScreenInfo(ws); err != nil {
		return remoteHostFailure("screen-info", err)
	}
	captureCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	done := make(chan remoteInputResult, 1)
	controls := make(chan remoteControl, 8)
	hostWatchdog := newRemoteHostLoopWatchdog()
	hostWatchdogCtx, stopHostWatchdog := context.WithCancel(captureCtx)
	hostWatchdogDone := startRemoteHostLoopWatchdog(hostWatchdogCtx, logger, hostWatchdog)
	defer func() { stopHostWatchdog(); <-hostWatchdogDone }()
	go readRemoteInput(captureCtx, ws, done, controls, hostWatchdog)
	caps := VideoCapabilities{Version: videoProtocolVersion, Codecs: []string{"jpeg"}}
	select {
	case c := <-controls:
		if c.capabilities != nil {
			caps = *c.capabilities
		}
	case r := <-done:
		cancel()
		return r.err
	case <-time.After(2 * time.Second):
	}
	source := videoSource(jpegVideoSource{})
	reason := "viewer_no_h264"
	if supportsH264(caps) {
		if h, e := newH264VideoSource(width, height); e == nil {
			source = h
			reason = ""
			name, hardware, _ := h.description()
			logger.event(fmt.Sprintf("REMOTE_ENCODER name=%s hardware=%t fps=30 bitrate=8000000", name, hardware))
			logger.event("REMOTE_ENCODER_INPUT mode=cpu_fallback")
		} else {
			reason = "encoder_init_failed"
		}
	}
	defer source.close()
	selected := VideoSelected{Version: videoProtocolVersion, Codec: source.codec(), Width: width, Height: height, FPS: 30, Format: "jpeg"}
	if selected.Codec == "h264" {
		selected.Format = "annexb"
	}
	p, e := videoControlPacket(PacketVideoSelected, selected)
	if e != nil {
		return remoteHostFailure("video-selection", e)
	}
	if e = writePacket(ws, p); e != nil {
		return remoteHostFailure("video-selection", e)
	}
	if source.codec() == "h264" {
		logger.event("REMOTE_VIDEO_MODE codec=h264")
	} else {
		logger.event("REMOTE_VIDEO_MODE codec=jpeg reason=" + reason)
	}
	var writer remotePacketWriter
	var failures <-chan frameWriteResult
	var writes <-chan time.Duration
	var put func([]byte, uint32)
	var drop func() uint64
	var stats func() (uint64, uint64, uint64)
	if h, ok := source.(*h264VideoSource); ok {
		w := newH264Writer(ws, h.forceKeyframe)
		writer = w
		failures = w.failures
		writes = w.writes
		put = w.enqueue
		drop = w.dropCount
		stats = w.stats
	} else {
		w := newLatestFrameWriter(ws)
		writer = w
		failures = w.failures
		writes = w.writes
		put = func(p []byte, _ uint32) { w.enqueue(p) }
		drop = w.dropCount
		stats = func() (uint64, uint64, uint64) { return 0, 0, 0 }
	}
	controller := remoteSessionController{ws: ws, writer: writer, cancelCapture: cancel, inputDone: done}
	defer controller.stop()
	videoWatchdog := newRemoteVideoStallWatchdog()
	hostWatchdog.advance(remoteHostLoopIdle)
	watchdogCtx, stopVideoWatchdog := context.WithCancel(ctx)
	watchdogDone := startRemoteVideoStallWatchdog(watchdogCtx, logger, videoWatchdog)
	defer func() {
		stopVideoWatchdog()
		<-watchdogDone
	}()
	var seq, aus, encodedBytes, keyframes, forced uint64
	em, wm := newFrameMetrics(120), newFrameMetrics(120)
	tick := time.NewTicker(time.Second / 30)
	defer tick.Stop()
	statsTick := time.NewTicker(4 * time.Second)
	defer statsTick.Stop()
	statsStarted := time.Now()
	var statsCaptureAttempts, statsAUs uint64
	logVideoStats := func() {
		elapsed := time.Since(statsStarted).Seconds()
		if elapsed <= 0 {
			return
		}
		g, a, f := stats()
		logger.event(fmt.Sprintf("REMOTE_VIDEO_STATS capture_fps=%.1f encode_fps=%.1f aus_encoded=%d bytes_encoded=%d keyframes=%d forced_keyframes=%d dropped_aus=%d dropped_gops=%d encode_ms=%.1f network_write_ms=%.1f", float64(statsCaptureAttempts)/elapsed, float64(statsAUs)/elapsed, aus, encodedBytes, keyframes, forced+f, drop()+a, g, float64(em.snapshot().Avg.Microseconds())/1000, float64(wm.snapshot().Avg.Microseconds())/1000))
		statsStarted = time.Now()
		statsCaptureAttempts = 0
		statsAUs = 0
	}
	for {
		select {
		case r := <-done:
			hostWatchdog.advance(remoteHostLoopWaitingInputShutdown)
			controller.finish(true)
			return r.err
		case f := <-failures:
			hostWatchdog.advance(remoteHostLoopWriterFailure)
			hostWatchdog.advance(remoteHostLoopResolveWriterFailure)
			if e := controller.resolveWriteFailure(ctx, f); e != nil {
				return e
			}
			return nil
		case d := <-writes:
			hostWatchdog.markWriterCompletion()
			wm.add(d)
			continue
		case c := <-controls:
			if c.keyframe && source.codec() == "h264" {
				logger.event("REMOTE_KEYFRAME_REQUEST_RECEIVED")
				e := source.forceKeyframe()
				logger.event(fmt.Sprintf("REMOTE_KEYFRAME_FORCED success=%t", e == nil))
				if e == nil {
					forced++
				}
			}
			continue
		case <-statsTick.C:
			hostWatchdog.markStatsTick()
			logVideoStats()
			continue
		case <-ctx.Done():
			hostWatchdog.advance(remoteHostLoopShutdown)
			return nil
		case <-tick.C:
			hostWatchdog.markVideoTick()
		}
		statsCaptureAttempts++
		videoWatchdog.begin(remoteVideoStageCapture, seq+1)
		hostWatchdog.advance(remoteHostLoopCapture)
		frame, changed, e := backend.Capture(captureCtx)
		videoWatchdog.end()
		hostWatchdog.markCapture()
		if e != nil {
			if recoverCapture, ok := backend.(interface{ Restart(context.Context) error }); ok && isRecoverableDXGIError(e) {
				if recoveryErr := recoverRemoteCapture(captureCtx, logger, recoverCapture, backend, width, height, e); recoveryErr == nil {
					if source.codec() == "h264" {
						if forceErr := source.forceKeyframe(); forceErr != nil {
							logger.event("REMOTE_VIDEO_RECOVERY_FAILED stage=encode cause=" + sanitizeRemoteLogError(forceErr))
							return remoteHostFailure("capture-recovery", forceErr)
						}
						forced++
					}
					continue
				} else {
					return remoteHostFailure("capture-recovery", recoveryErr)
				}
			}
			return remoteHostFailure(remoteCaptureStage(e), e)
		}
		if !changed {
			continue
		}
		seq++
		videoWatchdog.begin(remoteVideoStageEncode, seq)
		hostWatchdog.advance(remoteHostLoopEncode)
		out, e := source.encode(frame, seq, time.Now())
		videoWatchdog.end()
		hostWatchdog.markEncoded()
		if e != nil {
			return remoteHostFailure("encode", e)
		}
		if len(out.packet) == 0 {
			continue
		}
		videoWatchdog.begin(remoteVideoStageEnqueue, seq)
		hostWatchdog.advance(remoteHostLoopEnqueue)
		put(out.packet, out.flags)
		videoWatchdog.end()
		hostWatchdog.markQueued()
		em.add(out.encode)
		aus++
		encodedBytes += uint64(out.bytes)
		if out.flags&H264FlagKeyframe != 0 {
			keyframes++
		}
		statsAUs++
	}
}

func recoverRemoteCapture(ctx context.Context, logger *remoteLogger, restart interface{ Restart(context.Context) error }, backend CaptureBackend, expectedWidth, expectedHeight int, cause error) error {
	logger.event("REMOTE_VIDEO_RECOVERY_START stage=capture cause=" + sanitizeRemoteLogError(cause))
	var lastErr error
	for attempt := 1; attempt <= 3; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		if attempt > 1 {
			timer := time.NewTimer(250 * time.Millisecond)
			select {
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			case <-timer.C:
			}
		}
		if err := restart.Restart(ctx); err != nil {
			lastErr = err
			continue
		}
		width, height := backend.Dimensions()
		if width != expectedWidth || height != expectedHeight {
			lastErr = fmt.Errorf("desktop dimensions changed during DXGI recovery: %dx%d, expected %dx%d", width, height, expectedWidth, expectedHeight)
			break
		}
		logger.event(fmt.Sprintf("REMOTE_VIDEO_RECOVERY_SUCCESS stage=capture attempt=%d", attempt))
		return nil
	}
	if lastErr == nil {
		lastErr = cause
	}
	logger.event("REMOTE_VIDEO_RECOVERY_FAILED stage=capture cause=" + sanitizeRemoteLogError(lastErr))
	return lastErr
}

type remoteVideoStage uint32

const (
	remoteVideoStageIdle remoteVideoStage = iota
	remoteVideoStageCapture
	remoteVideoStageEncode
	remoteVideoStageEnqueue
)

func (s remoteVideoStage) String() string {
	switch s {
	case remoteVideoStageCapture:
		return "capture"
	case remoteVideoStageEncode:
		return "encode"
	case remoteVideoStageEnqueue:
		return "enqueue"
	default:
		return "idle"
	}
}

type remoteVideoStallWatchdog struct {
	stage    atomic.Uint32
	started  atomic.Int64
	sequence atomic.Uint64
}

func newRemoteVideoStallWatchdog() *remoteVideoStallWatchdog {
	return &remoteVideoStallWatchdog{}
}

func (w *remoteVideoStallWatchdog) begin(stage remoteVideoStage, sequence uint64) {
	w.sequence.Store(sequence)
	w.started.Store(time.Now().UnixNano())
	w.stage.Store(uint32(stage))
}

func (w *remoteVideoStallWatchdog) end() {
	w.stage.Store(uint32(remoteVideoStageIdle))
}

func startRemoteVideoStallWatchdog(ctx context.Context, logger *remoteLogger, watchdog *remoteVideoStallWatchdog) <-chan struct{} {
	done := make(chan struct{})
	go func() {
		defer close(done)
		tick := time.NewTicker(250 * time.Millisecond)
		defer tick.Stop()
		var reportedStage remoteVideoStage
		var reportedStarted int64
		var reportedSequence uint64
		var lastReport time.Time
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-tick.C:
				stage := remoteVideoStage(watchdog.stage.Load())
				started := watchdog.started.Load()
				sequence := watchdog.sequence.Load()
				if reportedStage != remoteVideoStageIdle && (stage != reportedStage || started != reportedStarted || sequence != reportedSequence) {
					duration := now.Sub(time.Unix(0, reportedStarted))
					logger.event(fmt.Sprintf("REMOTE_VIDEO_STALL_RECOVERED stage=%s duration_ms=%d sequence=%d", reportedStage, duration.Milliseconds(), reportedSequence))
					reportedStage = remoteVideoStageIdle
					lastReport = time.Time{}
				}
				if stage == remoteVideoStageIdle || started == 0 {
					continue
				}
				duration := now.Sub(time.Unix(0, started))
				if duration < time.Second {
					continue
				}
				if stage != reportedStage || started != reportedStarted || sequence != reportedSequence || now.Sub(lastReport) >= 5*time.Second {
					logger.event(fmt.Sprintf("REMOTE_VIDEO_STALL stage=%s duration_ms=%d sequence=%d", stage, duration.Milliseconds(), sequence))
					reportedStage = stage
					reportedStarted = started
					reportedSequence = sequence
					lastReport = now
				}
			}
		}
	}()
	return done
}

type remoteControl struct {
	capabilities *VideoCapabilities
	keyframe     bool
}

func supportsH264(c VideoCapabilities) bool {
	for _, v := range c.Codecs {
		if v == "h264" {
			return true
		}
	}
	return false
}
func captureFailureReason(err error) string {
	switch {
	case strings.Contains(err.Error(), "primary display"):
		return "display_unavailable"
	case strings.Contains(err.Error(), "BitBlt"):
		return "bitblt"
	case strings.Contains(err.Error(), "DIB_SECTION"):
		return "dib_section"
	case strings.Contains(err.Error(), "restore"):
		return "restore"
	case strings.Contains(err.Error(), "frame exceeds"):
		return "frame_too_large"
	default:
		return "capture"
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

func readRemoteInput(ctx context.Context, ws *websocket.Conn, done chan<- remoteInputResult, options ...any) {
	injected := newInjectedInputState()
	defer injected.releaseAll()
	var control chan<- remoteControl
	var watchdog *remoteHostLoopWatchdog
	for _, option := range options {
		switch value := option.(type) {
		case chan remoteControl:
			control = value
		case chan<- remoteControl:
			control = value
		case *remoteHostLoopWatchdog:
			watchdog = value
		}
	}
	last := time.Time{}
	for {
		kind, data, err := ws.ReadMessage()
		if err != nil {
			if isNormalWebSocketClose(err) || ctx.Err() != nil {
				done <- remoteInputResult{normal: true}
			} else {
				done <- remoteInputResult{err: remoteHostFailure("input-read", err)}
			}
			return
		}
		if kind != websocket.BinaryMessage || len(data) == 0 {
			done <- remoteInputResult{err: remoteHostFailure("input-invalid", fmt.Errorf("invalid remote packet"))}
			return
		}
		if watchdog != nil {
			watchdog.markInputPacket()
		}
		switch data[0] {
		case PacketVideoCapabilities:
			c, e := parseVideoCapabilities(data)
			if e != nil {
				done <- remoteInputResult{err: remoteHostFailure("video-capabilities", e)}
				return
			}
			select {
			case control <- remoteControl{capabilities: &c}:
			case <-ctx.Done():
				return
			}
		case PacketVideoKeyframe:
			if _, e := parseKeyframeRequest(data); e != nil {
				done <- remoteInputResult{err: remoteHostFailure("video-keyframe", e)}
				return
			}
			if time.Since(last) >= time.Second {
				last = time.Now()
				select {
				case control <- remoteControl{keyframe: true}:
				case <-ctx.Done():
					return
				}
			}
		case PacketInput:
			in, e := parseInput(data)
			if e != nil {
				done <- remoteInputResult{err: remoteHostFailure("input-invalid", e)}
				return
			}
			if e = injected.inject(in); e != nil {
				log.Printf("[RDP] remote input rejected: %s", sanitizeRemoteLogError(e))
			}
		default:
			done <- remoteInputResult{err: remoteHostFailure("input-invalid", fmt.Errorf("unsupported remote packet"))}
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
var selectObject = gdi32.NewProc("SelectObject")
var deleteObject = gdi32.NewProc("DeleteObject")
var deleteDC = gdi32.NewProc("DeleteDC")
var bitBlt = gdi32.NewProc("BitBlt")
var createDIBSection = gdi32.NewProc("CreateDIBSection")

func screenSize() (int, int) {
	w, _, _ := getSystemMetrics.Call(0)
	h, _, _ := getSystemMetrics.Call(1)
	return int(w), int(h)
}

type captureTiming struct{ capture, pixelConversion, jpegEncode time.Duration }

func capturePrimaryJPEG() ([]byte, error) {
	frame, _, err := capturePrimaryJPEGTimed()
	return frame, err
}

func capturePrimaryJPEGTimed() ([]byte, captureTiming, error) {
	var timing captureTiming
	captureStarted := time.Now()
	width, height := screenSize()
	info, pixelSize, err := newCaptureDIBInfo(width, height)
	if err != nil {
		return nil, timing, err
	}

	dc, _, callErr := getDC.Call(0)
	if dc == 0 {
		return nil, timing, captureAPIError("CAPTURE_GETDC_FAILED", width, height, dc, callErr)
	}
	defer func() {
		if released, _, releaseErr := releaseDC.Call(0, dc); released == 0 {
			log.Printf("[RDP] %s", captureAPIError("CAPTURE_RELEASE_DC_FAILED", width, height, released, releaseErr))
		}
	}()

	memory, _, callErr := createCompatibleDC.Call(dc)
	if memory == 0 {
		return nil, timing, captureAPIError("CAPTURE_CREATE_DC_FAILED", width, height, memory, callErr)
	}
	defer func() {
		if deleted, _, deleteErr := deleteDC.Call(memory); deleted == 0 {
			log.Printf("[RDP] %s", captureAPIError("CAPTURE_DELETE_DC_FAILED", width, height, deleted, deleteErr))
		}
	}()

	var bits unsafe.Pointer
	bitmap, _, callErr := createDIBSection.Call(dc, uintptr(unsafe.Pointer(&info)), dibRGBColors, uintptr(unsafe.Pointer(&bits)), 0, 0)
	if bitmap == 0 {
		return nil, timing, captureAPIError("CAPTURE_DIB_SECTION_FAILED", width, height, bitmap, callErr)
	}
	defer func() {
		if deleted, _, deleteErr := deleteObject.Call(bitmap); deleted == 0 {
			log.Printf("[RDP] %s", captureAPIError("CAPTURE_DELETE_BITMAP_FAILED", width, height, deleted, deleteErr))
		}
	}()
	if bits == nil {
		return nil, timing, captureAPIError("CAPTURE_DIB_SECTION_FAILED", width, height, 0, nil)
	}

	var order captureOrder
	old, _, callErr := selectObject.Call(memory, bitmap)
	if old == 0 || old == ^uintptr(0) {
		return nil, timing, captureAPIError("CAPTURE_SELECT_FAILED", width, height, old, callErr)
	}
	if err := order.selected(); err != nil {
		return nil, timing, err
	}

	restored := false
	restore := func() error {
		if restored {
			return nil
		}
		previous, _, restoreErr := selectObject.Call(memory, old)
		if previous == 0 || previous == ^uintptr(0) || previous != bitmap {
			return captureAPIError("CAPTURE_RESTORE_FAILED", width, height, previous, restoreErr)
		}
		restored = true
		return order.restored()
	}
	defer func() {
		if err := restore(); err != nil {
			log.Printf("[RDP] %s", err)
		}
	}()

	const srccopyCaptureBlt = 0x00CC0020 | 0x40000000
	copied, _, callErr := bitBlt.Call(memory, 0, 0, uintptr(width), uintptr(height), dc, 0, 0, srccopyCaptureBlt)
	if copied == 0 {
		return nil, timing, captureAPIError("CAPTURE_BITBLT_FAILED", width, height, copied, callErr)
	}
	if err := order.copied(); err != nil {
		return nil, timing, err
	}
	if err := restore(); err != nil {
		return nil, timing, err
	}
	if err := order.pixelsReady(); err != nil {
		return nil, timing, err
	}

	timing.capture = time.Since(captureStarted)
	pixelConversionStarted := time.Now()
	pixels := unsafe.Slice((*byte)(bits), pixelSize)
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for i := 0; i < len(pixels); i += captureBytesPerPixel {
		img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = pixels[i+2], pixels[i+1], pixels[i], 0xff
	}
	timing.pixelConversion = time.Since(pixelConversionStarted)
	var out bytes.Buffer
	encodeStarted := time.Now()
	// placing an oversized JPEG on the relay connection.
	for _, quality := range []int{75, 65, 55} {
		out.Reset()
		if err := jpeg.Encode(&out, img, &jpeg.Options{Quality: quality}); err != nil {
			return nil, timing, fmt.Errorf("CAPTURE_JPEG_FAILED width=%d height=%d: %w", width, height, err)
		}
		if out.Len() <= maxRemotePacket-1 {
			timing.jpegEncode = time.Since(encodeStarted)
			return out.Bytes(), timing, nil
		}
	}
	return nil, timing, fmt.Errorf("CAPTURE_JPEG_FAILED width=%d height=%d reason=frame_exceeds_limit", width, height)
}

const sentinelGridInputTag uintptr = 0x5347494E

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
}
type inputRecord struct {
	Type uint32
	Pad  uint32
	Data inputUnion
}

func sendInputRecord(input Input) error {
	var record inputRecord
	switch input.Type {
	case "mouse_move":
		w, h := screenSize()
		record.Data.Mouse.DX = int32(input.X * 65535 / max(1, w-1))
		record.Data.Mouse.DY = int32(input.Y * 65535 / max(1, h-1))
		record.Data.Mouse.ExtraInfo = sentinelGridInputTag
		record.Data.Mouse.Flags = 0x8001
	case "mouse_wheel":
		record.Data.Mouse.MouseData = uint32(int32(input.Delta))
		record.Data.Mouse.Flags = 0x0800
	case "mouse_down", "mouse_up":
		w, h := screenSize()
		record.Data.Mouse.DX = int32(input.X * 65535 / max(1, w-1))
		record.Data.Mouse.DY = int32(input.Y * 65535 / max(1, h-1))
		flags := map[string]uint32{"left": 0x0002, "right": 0x0008, "middle": 0x0020}
		if input.Type == "mouse_up" {
			flags = map[string]uint32{"left": 0x0004, "right": 0x0010, "middle": 0x0040}
		}
		// Button events carry their own absolute point so a dropped move cannot
		// make a click land at an earlier cursor position.
		record.Data.Mouse.ExtraInfo = sentinelGridInputTag
		record.Data.Mouse.Flags = 0x8001 | flags[input.Button]
	case "key_down", "key_up":
		record.Type = 1
		*(*keyInput)(unsafe.Pointer(&record.Data)) = keyInput{VK: input.VK, Scan: input.Scan, ExtraInfo: sentinelGridInputTag}
		if input.Extended {
			(*keyInput)(unsafe.Pointer(&record.Data)).Flags |= 0x0001
		}
		if input.Type == "key_up" {
			(*keyInput)(unsafe.Pointer(&record.Data)).Flags |= 0x0002
		}
	default:
		return fmt.Errorf("unsupported remote input")
	}
	if unsafe.Sizeof(record) != 40 {
		return fmt.Errorf("invalid Windows INPUT layout: %d bytes", unsafe.Sizeof(record))
	}
	if count, _, err := sendInput.Call(1, uintptr(unsafe.Pointer(&record)), unsafe.Sizeof(record)); count != 1 {
		return fmt.Errorf("Windows rejected remote input (sent=%d): %v", count, err)
	}
	return nil
}
