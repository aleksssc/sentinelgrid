//go:build windows

package rdp

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"log"
	"os"
	"strings"
	"time"
	"unicode/utf16"
	"unsafe"

	"github.com/gorilla/websocket"
	"golang.org/x/sys/windows"
)

const createUnicodeEnvironment = 0x00000400

func LaunchInteractive(ctx context.Context, connection Connection) (launchErr error) {
	var logger *remoteLogger
	if err := provisionRemoteLog(); err != nil {
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

	log.Print("[RDP] session received")
	session := windows.WTSGetActiveConsoleSessionId()
	if session == 0xffffffff {
		return fmt.Errorf("no active interactive Windows session")
	}
	logger.event(fmt.Sprintf("REMOTE_ACTIVE_SESSION %d", session))
	log.Print("[RDP] interactive session detected")

	var token windows.Token
	if err := windows.WTSQueryUserToken(session, &token); err != nil {
		return fmt.Errorf("interactive user token unavailable: %w", err)
	}
	defer token.Close()
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
	logger.event("REMOTE_ENV_VALID")
	logger.event("REMOTE_RELAY_CONNECTING")
	log.Print("[RDP] remote host connecting")
	ws, err := Dial(ctx, connection)
	if err != nil {
		if strings.Contains(err.Error(), "pairing") {
			return remoteHostFailure("pairing", err)
		}
		return remoteHostFailure("relay", err)
	}
	defer ws.Close()
	logger.event("REMOTE_RELAY_CONNECTED")
	log.Print("[RDP] relay connected")
	logger.event("REMOTE_PAIRED")
	log.Print("[RDP] remote host paired")
	if err := sendScreenInfo(ws); err != nil {
		return remoteHostFailure("screen-info", err)
	}
	logger.event("REMOTE_CAPTURE_START")
	log.Print("[RDP] REMOTE_CAPTURE_START")
	inputDone := make(chan error, 1)
	go readRemoteInput(ctx, ws, inputDone)
	firstFrame := true
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
				logger.event("REMOTE_CAPTURE_FAILED " + sanitizeRemoteLogError(err))
				log.Printf("[RDP] REMOTE_CAPTURE_FAILED %s", captureFailureReason(err))
				return remoteHostFailure(remoteCaptureStage(err), err)
			}
			if firstFrame {
				logger.event("REMOTE_CAPTURE_FIRST_FRAME_OK")
				log.Print("[RDP] REMOTE_CAPTURE_FIRST_FRAME_OK")
				firstFrame = false
			}
			data, err := packet(PacketFrame, jpg)
			if err != nil {
				return remoteHostFailure("frame-size", err)
			}
			if err := writePacket(ws, data); err != nil {
				return remoteHostFailure("frame-send", err)
			}
		}
	}
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

func readRemoteInput(ctx context.Context, ws *websocket.Conn, done chan<- error) {
	for {
		kind, data, err := ws.ReadMessage()
		if err != nil {
			var closeErr *websocket.CloseError
			if errors.As(err, &closeErr) && (closeErr.Code == websocket.CloseNormalClosure || closeErr.Code == websocket.CloseGoingAway) {
				done <- nil
			} else {
				done <- remoteHostFailure("input-read", fmt.Errorf("remote input connection closed: %w", err))
			}
			return
		}
		if kind != websocket.BinaryMessage {
			done <- remoteHostFailure("input-invalid", fmt.Errorf("non-binary remote input"))
			return
		}
		input, err := parseInput(data)
		if err != nil {
			done <- remoteHostFailure("input-invalid", err)
			return
		}
		if err = injectInput(input); err != nil {
			// Input is best-effort: UIPI or a transient desktop restriction must not stop video.
			log.Printf("[RDP] remote input rejected: %s", sanitizeRemoteLogError(err))
			continue
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

func capturePrimaryJPEG() ([]byte, error) {
	width, height := screenSize()
	info, pixelSize, err := newCaptureDIBInfo(width, height)
	if err != nil {
		return nil, err
	}

	dc, _, callErr := getDC.Call(0)
	if dc == 0 {
		return nil, captureAPIError("CAPTURE_GETDC_FAILED", width, height, dc, callErr)
	}
	defer func() {
		if released, _, releaseErr := releaseDC.Call(0, dc); released == 0 {
			log.Printf("[RDP] %s", captureAPIError("CAPTURE_RELEASE_DC_FAILED", width, height, released, releaseErr))
		}
	}()

	memory, _, callErr := createCompatibleDC.Call(dc)
	if memory == 0 {
		return nil, captureAPIError("CAPTURE_CREATE_DC_FAILED", width, height, memory, callErr)
	}
	defer func() {
		if deleted, _, deleteErr := deleteDC.Call(memory); deleted == 0 {
			log.Printf("[RDP] %s", captureAPIError("CAPTURE_DELETE_DC_FAILED", width, height, deleted, deleteErr))
		}
	}()

	var bits unsafe.Pointer
	bitmap, _, callErr := createDIBSection.Call(dc, uintptr(unsafe.Pointer(&info)), dibRGBColors, uintptr(unsafe.Pointer(&bits)), 0, 0)
	if bitmap == 0 {
		return nil, captureAPIError("CAPTURE_DIB_SECTION_FAILED", width, height, bitmap, callErr)
	}
	defer func() {
		if deleted, _, deleteErr := deleteObject.Call(bitmap); deleted == 0 {
			log.Printf("[RDP] %s", captureAPIError("CAPTURE_DELETE_BITMAP_FAILED", width, height, deleted, deleteErr))
		}
	}()
	if bits == nil {
		return nil, captureAPIError("CAPTURE_DIB_SECTION_FAILED", width, height, 0, nil)
	}

	var order captureOrder
	old, _, callErr := selectObject.Call(memory, bitmap)
	if old == 0 || old == ^uintptr(0) {
		return nil, captureAPIError("CAPTURE_SELECT_FAILED", width, height, old, callErr)
	}
	if err := order.selected(); err != nil {
		return nil, err
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
		return nil, captureAPIError("CAPTURE_BITBLT_FAILED", width, height, copied, callErr)
	}
	if err := order.copied(); err != nil {
		return nil, err
	}
	if err := restore(); err != nil {
		return nil, err
	}
	if err := order.pixelsReady(); err != nil {
		return nil, err
	}

	pixels := unsafe.Slice((*byte)(bits), pixelSize)
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for i := 0; i < len(pixels); i += captureBytesPerPixel {
		img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = pixels[i+2], pixels[i+1], pixels[i], 0xff
	}
	var out bytes.Buffer
	// Prefer readable desktop text, but retry at lower quality rather than ever
	// placing an oversized JPEG on the relay connection.
	for _, quality := range []int{75, 65, 55} {
		out.Reset()
		if err := jpeg.Encode(&out, img, &jpeg.Options{Quality: quality}); err != nil {
			return nil, fmt.Errorf("CAPTURE_JPEG_FAILED width=%d height=%d: %w", width, height, err)
		}
		if out.Len() <= maxRemotePacket-1 {
			return out.Bytes(), nil
		}
	}
	return nil, fmt.Errorf("CAPTURE_JPEG_FAILED width=%d height=%d reason=frame_exceeds_limit", width, height)
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
		w, h := screenSize()
		record.Data.Mouse.DX = int32(input.X * 65535 / max(1, w-1))
		record.Data.Mouse.DY = int32(input.Y * 65535 / max(1, h-1))
		flags := map[string]uint32{"left": 0x0002, "right": 0x0008, "middle": 0x0020}
		if input.Type == "mouse_up" {
			flags = map[string]uint32{"left": 0x0004, "right": 0x0010, "middle": 0x0040}
		}
		// Button events carry their own absolute point so a dropped move cannot
		// make a click land at an earlier cursor position.
		record.Data.Mouse.Flags = 0x8001 | flags[input.Button]
	case "key_down", "key_up":
		record.Type = 1
		*(*keyInput)(unsafe.Pointer(&record.Data)) = keyInput{VK: input.VK}
		if input.Type == "key_up" {
			(*keyInput)(unsafe.Pointer(&record.Data)).Flags = 0x0002
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
