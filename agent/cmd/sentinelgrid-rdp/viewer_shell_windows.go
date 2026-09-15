//go:build windows

package main

import (
	"fmt"
	"syscall"
	"unsafe"

	"sentinelgrid/agent/internal/rdp"
)

const (
	wmSysCommand                = 0x0112
	wmKeyDownShell              = 0x0100
	wmSetCursor                 = 0x0020
	scMaximize                  = 0xf030
	gwlStyle                    = ^uintptr(15)
	wsPopup                     = 0x80000000
	swpFrameChanged             = 0x0020
	swpNoOwnerZOrder            = 0x0200
	swpNoZOrder                 = 0x0004
	monitorDefaultToNearest     = 2
	dwmwaUseImmersiveDarkMode   = 20
	dwmwaWindowCornerPreference = 33
	dwmwaBorderColor            = 34
	dwmwaCaptionColor           = 35
	dwmwaTextColor              = 36
	dwmwcpRound                 = 2
)

var (
	viewerDwmapi          = syscall.NewLazyDLL("dwmapi.dll")
	dwmSetWindowAttribute = viewerDwmapi.NewProc("DwmSetWindowAttribute")
	moveWindow            = viewerUser32.NewProc("MoveWindow")
	setWindowLongPtr      = viewerUser32.NewProc("SetWindowLongPtrW")
	getWindowLongPtr      = viewerUser32.NewProc("GetWindowLongPtrW")
	setWindowPos          = viewerUser32.NewProc("SetWindowPos")
	getWindowPlacement    = viewerUser32.NewProc("GetWindowPlacement")
	setWindowPlacement    = viewerUser32.NewProc("SetWindowPlacement")
	monitorFromWindow     = viewerUser32.NewProc("MonitorFromWindow")
	getMonitorInfo        = viewerUser32.NewProc("GetMonitorInfoW")
)

type windowPlacement struct {
	Length                   uint32
	Flags, ShowCmd           uint32
	MinPosition, MaxPosition point
	NormalPosition           rect
}

type monitorInfo struct {
	Size          uint32
	Monitor, Work rect
	Flags         uint32
}

func setDWMAttribute(hwnd uintptr, attribute uint32, value unsafe.Pointer, size uintptr) {
	if hwnd != 0 {
		_, _, _ = dwmSetWindowAttribute.Call(hwnd, uintptr(attribute), uintptr(value), size)
	}
}

func (v *viewer) applyWindowChrome(hwnd uintptr) {
	dark := int32(1)
	setDWMAttribute(hwnd, dwmwaUseImmersiveDarkMode, unsafe.Pointer(&dark), unsafe.Sizeof(dark))
	caption, border, text, corner := uint32(0x0012151a), uint32(0x00252a32), uint32(0x00f4f5f7), uint32(dwmwcpRound)
	setDWMAttribute(hwnd, dwmwaCaptionColor, unsafe.Pointer(&caption), unsafe.Sizeof(caption))
	setDWMAttribute(hwnd, dwmwaBorderColor, unsafe.Pointer(&border), unsafe.Sizeof(border))
	setDWMAttribute(hwnd, dwmwaTextColor, unsafe.Pointer(&text), unsafe.Sizeof(text))
	setDWMAttribute(hwnd, dwmwaWindowCornerPreference, unsafe.Pointer(&corner), unsafe.Sizeof(corner))
}

func (v *viewer) layoutShell(hwnd uintptr) {
	var client rect
	getClientRect.Call(hwnd, uintptr(unsafe.Pointer(&client)))
	layout := viewerLayoutForClient(int(client.Right-client.Left), int(client.Bottom-client.Top))
	v.mu.Lock()
	if v.showStats {
		layout.video.width = max(0, layout.video.width-272)
	}
	v.shell = layout
	videoHost := v.videoHost
	v.mu.Unlock()
	if videoHost != 0 {
		moveWindow.Call(videoHost, uintptr(layout.video.x), uintptr(layout.video.y), uintptr(layout.video.width), uintptr(layout.video.height), 1)
	}
}

func (v *viewer) shellAction(action string) {
	switch action {
	case "fit":
		v.mu.Lock()
		v.scaleMode = viewerScaleFit
		v.mu.Unlock()
	case "actual":
		v.mu.Lock()
		frame, video := v.frame, v.shell.video
		if _, ok := actualSizeRect(video.width, video.height, frame.width, frame.height); ok {
			v.status = "100% view is unavailable until native viewport support is enabled"
		} else {
			v.status = "100% is unavailable because the remote desktop exceeds this viewport"
		}
		v.mu.Unlock()
	case "fullscreen":
		v.toggleFullscreen()
	case "stats":
		v.mu.Lock()
		v.showStats = !v.showStats
		hwnd := v.hwnd
		v.mu.Unlock()
		v.layoutShell(hwnd)
	case "disconnect":
		v.setStatus("Disconnecting...")
		v.requestClose()
		v.input.releaseOnFocusLoss()
		postMessage.Call(v.hwnd, wmClose, 0, 0)
	}
	if v.hwnd != 0 {
		invalidateRect.Call(v.hwnd, 0, 0, 0)
	}
}

func (v *viewer) toggleFullscreen() {
	v.mu.Lock()
	hwnd := v.hwnd
	if hwnd == 0 {
		v.mu.Unlock()
		return
	}
	if !v.fullscreen {
		placement := windowPlacement{Length: uint32(unsafe.Sizeof(windowPlacement{}))}
		getWindowPlacement.Call(hwnd, uintptr(unsafe.Pointer(&placement)))
		v.restorePlacement = placement
		v.restoreStyle, _, _ = getWindowLongPtr.Call(hwnd, gwlStyle)
		v.fullscreen = true
		v.mu.Unlock()
		monitor, _, _ := monitorFromWindow.Call(hwnd, monitorDefaultToNearest)
		info := monitorInfo{Size: uint32(unsafe.Sizeof(monitorInfo{}))}
		getMonitorInfo.Call(monitor, uintptr(unsafe.Pointer(&info)))
		setWindowLongPtr.Call(hwnd, gwlStyle, wsPopup)
		setWindowPos.Call(hwnd, 0, uintptr(info.Monitor.Left), uintptr(info.Monitor.Top), uintptr(info.Monitor.Right-info.Monitor.Left), uintptr(info.Monitor.Bottom-info.Monitor.Top), swpFrameChanged|swpNoOwnerZOrder|swpNoZOrder)
	} else {
		placement, style := v.restorePlacement, v.restoreStyle
		v.fullscreen = false
		v.mu.Unlock()
		setWindowLongPtr.Call(hwnd, gwlStyle, style)
		setWindowPlacement.Call(hwnd, uintptr(unsafe.Pointer(&placement)))
		setWindowPos.Call(hwnd, 0, 0, 0, 0, 0, swpFrameChanged|swpNoOwnerZOrder|swpNoZOrder)
		v.layoutShell(hwnd)
		return
	}
	v.layoutShell(hwnd)
}

func (v *viewer) drawToolbar(hdc uintptr, client rect) {
	v.mu.RLock()
	layout, state, statsOpen, mode := v.shell, v.sessionState, v.showStats, v.scaleMode
	v.mu.RUnlock()
	fillStatusRect(hdc, layout.toolbarRect(), rgb(18, 21, 26))
	fillStatusRect(hdc, rect{Left: 0, Top: int32(layout.toolbar.height - 1), Right: client.Right, Bottom: int32(layout.toolbar.height)}, rgb(37, 42, 50))
	drawStatusMark(hdc, 16, 13, 24, rgb(18, 21, 26))
	drawStatusText(hdc, "SentinelGrid Remote", rect{Left: 48, Top: 9, Right: 250, Bottom: 34}, rgb(244, 245, 247), 14, fontWeightSemiBold)
	stateLabel, color := state.label(), rgb(96, 165, 250)
	switch state {
	case viewerStateConnected:
		color = rgb(130, 201, 167)
	case viewerStateDisconnecting:
		color = rgb(228, 187, 114)
	case viewerStateSessionEnded:
		color = rgb(174, 181, 191)
	case viewerStateConnectionLost:
		color = rgb(241, 152, 161)
	}
	fillStatusEllipse(hdc, rect{Left: 258, Top: 21, Right: 264, Bottom: 27}, color)
	drawStatusText(hdc, stateLabel, rect{Left: 270, Top: 11, Right: 390, Bottom: 37}, color, 12, fontWeightSemiBold)
	for _, item := range []struct{ name, label string }{{"fit", "Fit"}, {"fullscreen", "Fullscreen"}, {"stats", "Stats"}, {"disconnect", "Disconnect"}} {
		area := layout.buttons[item.name]
		fill, border, text := rgb(18, 21, 26), rgb(37, 42, 50), rgb(226, 232, 240)

		if item.name == "disconnect" {
			fill, border, text = rgb(57, 25, 31), rgb(116, 47, 57), rgb(241, 152, 161)
		}
		if item.name == "fit" && mode == viewerScaleFit {
			fill, border, text = rgb(17, 30, 50), rgb(43, 70, 106), rgb(147, 197, 253)
		}
		drawStatusRoundRect(hdc, area.toRect(), 8, fill, border)
		drawCenteredStatusText(hdc, item.label, area.toRect(), text, 11, fontWeightSemiBold)
	}
	if statsOpen {
		v.drawStatsPopover(hdc, layout)
	}
}

func (v *viewer) drawStatsPopover(hdc uintptr, layout viewerShellLayout) {
	v.mu.RLock()
	codec, width, height, decoded, presented, backend, state := v.videoCodec, v.screenWidth, v.screenHeight, v.decodedCompleted, v.successfulPresents, v.rendererBackend, v.sessionState
	v.mu.RUnlock()
	panel := rect{Left: int32(layout.video.x + layout.video.width + 12), Top: int32(layout.toolbar.height + 12), Right: int32(layout.toolbar.width - 12), Bottom: int32(layout.toolbar.height + 170)}
	drawStatusRoundRect(hdc, panel, 10, rgb(18, 21, 26), rgb(37, 42, 50))
	drawStatusText(hdc, "Connection stats", rect{Left: panel.Left + 14, Top: panel.Top + 10, Right: panel.Right - 12, Bottom: panel.Top + 32}, rgb(244, 245, 247), 12, fontWeightSemiBold)
	lines := []string{fmt.Sprintf("Connection: %s", state.label()), fmt.Sprintf("Codec: %s", codec), fmt.Sprintf("Remote: %dx%d", width, height), "Target FPS: 30", fmt.Sprintf("Decoded frames: %d", decoded), fmt.Sprintf("Presented frames: %d", presented), fmt.Sprintf("Renderer: %s", backend)}
	for i, line := range lines {
		drawStatusText(hdc, line, rect{Left: panel.Left + 14, Top: panel.Top + 36 + int32(i*18), Right: panel.Right - 12, Bottom: panel.Top + 54 + int32(i*18)}, rgb(149, 156, 168), 11, fontWeightNormal)
	}
}

func (l viewerShellLayout) toolbarRect() rect {
	return rect{Left: int32(l.toolbar.x), Top: int32(l.toolbar.y), Right: int32(l.toolbar.x + l.toolbar.width), Bottom: int32(l.toolbar.y + l.toolbar.height)}
}
func (r imageRect) toRect() rect {
	return rect{Left: int32(r.x), Top: int32(r.y), Right: int32(r.x + r.width), Bottom: int32(r.y + r.height)}
}

func videoHostProc(hwnd uintptr, message uint32, wparam, lparam uintptr) uintptr {
	v := activeViewer
	if v == nil {
		result, _, _ := defWindowProc.Call(hwnd, uintptr(message), wparam, lparam)
		return result
	}
	switch message {
	case wmSize:
		v.resizeVideoHost(hwnd)
		return 0
	case wmPaint:
		v.paint(hwnd)
		return 0
	case wmMouseMove:
		v.sendMouse(hwnd, "mouse_move", "", 0, lparam)
	case wmLButtonDown:
		setFocus.Call(hwnd)
		v.sendMouse(hwnd, "mouse_down", "left", 0, lparam)
	case wmLButtonUp:
		v.sendMouse(hwnd, "mouse_up", "left", 0, lparam)
	case wmRButtonDown:
		setFocus.Call(hwnd)
		v.sendMouse(hwnd, "mouse_down", "right", 0, lparam)
	case wmRButtonUp:
		v.sendMouse(hwnd, "mouse_up", "right", 0, lparam)
	case wmMButtonDown:
		setFocus.Call(hwnd)
		v.sendMouse(hwnd, "mouse_down", "middle", 0, lparam)
	case wmMButtonUp:
		v.sendMouse(hwnd, "mouse_up", "middle", 0, lparam)
	case wmMouseWheel:
		v.queueInput(rdp.Input{Type: "mouse_wheel", Delta: int(int16(wparam >> 16))})
	case wmKeyDown, wmSysKeyDown:
		if !viewerMessageIsInjected() {
			v.queueInput(keyboardInput("key_down", wparam, lparam))
		}
	case wmKeyUp, wmSysKeyUp:
		if !viewerMessageIsInjected() {
			v.queueInput(keyboardInput("key_up", wparam, lparam))
		}
	case wmKillFocus:
		if v.input != nil {
			v.input.releaseOnFocusLoss()
		}
	}
	result, _, _ := defWindowProc.Call(hwnd, uintptr(message), wparam, lparam)
	return result
}

func (v *viewer) resizeVideoHost(hwnd uintptr) {
	v.mu.RLock()
	renderer := v.renderer
	v.mu.RUnlock()
	if renderer == nil {
		return
	}
	var client rect
	getClientRect.Call(hwnd, uintptr(unsafe.Pointer(&client)))
	if err := renderer.resize(int(client.Right), int(client.Bottom)); err != nil {
		v.logger.event("VIEWER_D3D11_RESIZE_FAILED")
	}
}

func (v *viewer) paintToolbar(hwnd uintptr) {
	var paint paintStruct
	hdc, _, _ := beginPaint.Call(hwnd, uintptr(unsafe.Pointer(&paint)))
	if hdc == 0 {
		return
	}
	defer endPaint.Call(hwnd, uintptr(unsafe.Pointer(&paint)))
	var client rect
	getClientRect.Call(hwnd, uintptr(unsafe.Pointer(&client)))
	fillStatusRect(hdc, client, rgb(10, 10, 12))
	v.drawToolbar(hdc, client)
}

func (v *viewer) paintTerminalStatus(hdc uintptr, client rect, state viewerSessionState) {
	fillStatusRect(hdc, client, rgb(10, 10, 12))
	cardWidth, cardHeight := int32(380), int32(150)
	card := rect{Left: (client.Right - cardWidth) / 2, Top: (client.Bottom - cardHeight) / 2, Right: (client.Right + cardWidth) / 2, Bottom: (client.Bottom + cardHeight) / 2}
	drawStatusRoundRect(hdc, card, 14, rgb(18, 21, 26), rgb(37, 42, 50))
	color, detail := rgb(241, 152, 161), "The remote session has ended. Start a new Remote session from SentinelGrid."
	if state == viewerStateSessionEnded {
		color, detail = rgb(174, 181, 191), "The remote session ended normally."
	}
	drawCenteredStatusText(hdc, state.label(), rect{Left: card.Left + 20, Top: card.Top + 30, Right: card.Right - 20, Bottom: card.Top + 60}, color, 16, fontWeightSemiBold)
	drawCenteredStatusText(hdc, detail, rect{Left: card.Left + 28, Top: card.Top + 70, Right: card.Right - 28, Bottom: card.Top + 104}, rgb(174, 181, 191), 11, fontWeightNormal)
	drawCenteredStatusText(hdc, "Use Disconnect to close this window.", rect{Left: card.Left + 20, Top: card.Top + 112, Right: card.Right - 20, Bottom: card.Bottom - 18}, rgb(149, 156, 168), 11, fontWeightNormal)
}
