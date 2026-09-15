//go:build windows

package main

import (
	"time"
	"unsafe"

	"github.com/gorilla/websocket"
)

const (
	wmMouseLeave           = 0x02a3
	wmCaptureChanged       = 0x0215
	swpNoSize              = 0x0001
	swpNoMove              = 0x0002
	fullscreenRestoreFlags = swpFrameChanged | swpNoOwnerZOrder | swpNoZOrder | swpNoSize | swpNoMove
)

func (v *viewer) beginShutdown() {
	v.requestClose()
	v.shutdownOnce.Do(func() {
		v.shutdownDone = make(chan struct{})
		go func() {
			defer close(v.shutdownDone)
			v.mu.RLock()
			ws := v.ws
			v.mu.RUnlock()
			// A single session-wide grace bounds all queued releases, not each key.
			deadline := time.Now().Add(time.Second)
			abort := time.AfterFunc(time.Until(deadline), func() {
				if ws != nil {
					_ = ws.Close()
				}
			})
			defer abort.Stop()
			if v.input != nil {
				v.input.close()
			}
			if ws != nil {
				if err := ws.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "Viewer closed"), deadline); err != nil {
					v.logger.event("VIEWER_CLOSE_CONTROL_FAILED")
				}
				_ = ws.Close()
			}
			if v.compressed != nil {
				v.compressed.close()
			}
		}()
	})
}

func (v *viewer) localShellKey(message uint32, wparam, lparam uintptr) bool {
	switch message {
	case wmKeyDown, wmKeyUp, wmSysKeyDown, wmSysKeyUp:
		if viewerMessageIsInjected() {
			return true
		}
	}
	if (message == wmSysKeyDown || message == wmSysKeyUp) && wparam == 0x73 && lparam&(1<<29) != 0 {
		if message == wmSysKeyDown {
			v.shellAction("disconnect")
		}
		return true
	}
	v.mu.RLock()
	fullscreen, terminal := v.fullscreen, v.sessionState.terminal()
	v.mu.RUnlock()
	if message == wmKeyDown && wparam == 27 && fullscreen {
		v.toggleFullscreen()
		return true
	}
	if message == wmKeyDown && terminal && (wparam == 13 || wparam == 27) {
		v.shellAction("disconnect")
		return true
	}
	return false
}

func (v *viewer) handleShellPointer(hwnd uintptr, message uint32, lparam uintptr) bool {
	v.mu.Lock()
	action := v.shell.actionAt(int(int16(lparam)), int(int16(lparam>>16)))
	if message == wmMouseLeave || message == wmCaptureChanged {
		action = ""
	}
	oldHover, oldPressed := v.hoverAction, v.pressedAction
	v.hoverAction = action
	invoke := ""
	switch message {
	case wmLButtonDown:
		v.pressedAction = action
	case wmLButtonUp:
		if action == v.pressedAction {
			invoke = action
		}
		v.pressedAction = ""
	case wmCaptureChanged:
		v.pressedAction = ""
	}
	changed := oldHover != v.hoverAction || oldPressed != v.pressedAction
	v.mu.Unlock()
	if message == wmMouseMove {
		tracking := struct {
			Size, Flags uint32
			Hwnd        uintptr
			HoverTime   uint32
		}{Flags: 2, Hwnd: hwnd}
		tracking.Size = uint32(unsafe.Sizeof(tracking))
		viewerUser32.NewProc("TrackMouseEvent").Call(uintptr(unsafe.Pointer(&tracking)))
	}
	if message == wmLButtonDown && action != "" {
		viewerUser32.NewProc("SetCapture").Call(hwnd)
	}
	if message == wmLButtonUp {
		viewerUser32.NewProc("ReleaseCapture").Call()
	}
	if changed {
		invalidateRect.Call(hwnd, 0, 0, 0)
	}
	if invoke != "" {
		v.shellAction(invoke)
	}
	return action != "" || oldPressed != ""
}

func terminalCloseRect(width, height int) imageRect {
	return imageRect{x: (width - 88) / 2, y: (height-210)/2 + 150, width: 88, height: 34}
}

func (r imageRect) contains(x, y int) bool {
	return r.width > 0 && r.height > 0 && x >= r.x && y >= r.y && x < r.x+r.width && y < r.y+r.height
}
