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
	if hwnd != 0 && dwmSetWindowAttribute.Find() == nil {
		_, _, _ = dwmSetWindowAttribute.Call(hwnd, uintptr(attribute), uintptr(value), size)
	}
}

func (v *viewer) applyWindowChrome(hwnd uintptr) {
	dark := int32(1)
	setDWMAttribute(hwnd, dwmwaUseImmersiveDarkMode, unsafe.Pointer(&dark), unsafe.Sizeof(dark))
	caption, border, text, corner := uint32(rgb(18, 21, 26)), uint32(rgb(37, 42, 50)), uint32(rgb(244, 245, 247)), uint32(dwmwcpRound)
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
		v.beginShutdown()
		v.mu.RLock()
		hwnd := v.hwnd
		v.mu.RUnlock()
		if hwnd != 0 {
			postMessage.Call(hwnd, wmClose, 0, 0)
		}
	}
	if v.hwnd != 0 {
		invalidateRect.Call(v.hwnd, 0, 0, 0)
	}
}

func (v *viewer) toggleFullscreen() {
	v.mu.Lock()
	hwnd, fullscreen := v.hwnd, v.fullscreen
	v.mu.Unlock()
	if hwnd == 0 {
		return
	}
	placement := windowPlacement{Length: uint32(unsafe.Sizeof(windowPlacement{}))}
	var style uintptr
	var info monitorInfo
	if !fullscreen {
		if ok, _, _ := getWindowPlacement.Call(hwnd, uintptr(unsafe.Pointer(&placement))); ok == 0 {
			v.logger.event("VIEWER_FULLSCREEN_FAILED stage=placement")
			return
		}
		style, _, _ = getWindowLongPtr.Call(hwnd, gwlStyle)
		monitor, _, _ := monitorFromWindow.Call(hwnd, monitorDefaultToNearest)
		info = monitorInfo{Size: uint32(unsafe.Sizeof(monitorInfo{}))}
		if ok, _, _ := getMonitorInfo.Call(monitor, uintptr(unsafe.Pointer(&info))); ok == 0 {
			v.logger.event("VIEWER_FULLSCREEN_FAILED stage=monitor")
			return
		}
		v.mu.Lock()
		v.restorePlacement, v.restoreStyle = placement, style
		v.mu.Unlock()
	} else {
		v.mu.RLock()
		placement, style = v.restorePlacement, v.restoreStyle
		v.mu.RUnlock()
	}
	v.mu.Lock()
	v.shellTransition = true
	v.mu.Unlock()
	defer func() {
		v.mu.Lock()
		v.shellTransition = false
		v.mu.Unlock()
		v.layoutShell(hwnd)
		invalidateRect.Call(hwnd, 0, 0, 0)
		invalidateRect.Call(v.presentationHWND(), 0, 0, 0)
	}()
	if !fullscreen {
		if previous, _, _ := setWindowLongPtr.Call(hwnd, gwlStyle, wsPopup|0x02000000|(style&wsVisible)); previous == 0 {
			v.logger.event("VIEWER_FULLSCREEN_FAILED stage=style")
			return
		}
		if ok, _, _ := setWindowPos.Call(hwnd, 0, uintptr(info.Monitor.Left), uintptr(info.Monitor.Top), uintptr(info.Monitor.Right-info.Monitor.Left), uintptr(info.Monitor.Bottom-info.Monitor.Top), swpFrameChanged|swpNoOwnerZOrder|swpNoZOrder); ok == 0 {
			setWindowLongPtr.Call(hwnd, gwlStyle, style)
			setWindowPlacement.Call(hwnd, uintptr(unsafe.Pointer(&placement)))
			v.logger.event("VIEWER_FULLSCREEN_FAILED stage=position")
			return
		}
	} else {
		if previous, _, _ := setWindowLongPtr.Call(hwnd, gwlStyle, style); previous == 0 {
			v.logger.event("VIEWER_FULLSCREEN_FAILED stage=restore_style")
			return
		}
		if ok, _, _ := setWindowPlacement.Call(hwnd, uintptr(unsafe.Pointer(&placement))); ok == 0 {
			v.logger.event("VIEWER_FULLSCREEN_FAILED stage=restore_placement")
			return
		}
		if ok, _, _ := setWindowPos.Call(hwnd, 0, 0, 0, 0, 0, fullscreenRestoreFlags); ok == 0 {
			v.logger.event("VIEWER_FULLSCREEN_FAILED stage=restore_frame")
			return
		}
	}
	v.mu.Lock()
	v.fullscreen = !fullscreen
	v.mu.Unlock()
}

func (v *viewer) drawToolbar(hdc uintptr, client rect) {
	v.mu.RLock()
	layout, state, statsOpen, mode := v.shell, v.sessionState, v.showStats, v.scaleMode
	hover, pressed, fullscreen := v.hoverAction, v.pressedAction, v.fullscreen
	v.mu.RUnlock()
	fillStatusRect(hdc, layout.toolbarRect(), rgb(18, 21, 26))
	fillStatusRect(hdc, rect{Left: 0, Top: int32(layout.toolbar.height - 1), Right: client.Right, Bottom: int32(layout.toolbar.height)}, rgb(37, 42, 50))
	if layout.buttons["fit"].x >= 400 {
		drawStatusMark(hdc, 16, 13, 24, rgb(18, 21, 26))
		drawStatusText(hdc, "SentinelGrid Remote", rect{Left: 48, Top: 9, Right: 245, Bottom: 39}, rgb(244, 245, 247), 16, fontWeightSemiBold)
	}
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
	chipLeft := int32(250)
	if layout.buttons["fit"].x < 400 {
		chipLeft = 12
	}
	if int(chipLeft)+140 < layout.buttons["fit"].x {
		drawStatusRoundRect(hdc, rect{Left: chipLeft, Top: 12, Right: chipLeft + 140, Bottom: 38}, 12, rgb(9, 11, 14), rgb(37, 42, 50))
		fillStatusEllipse(hdc, rect{Left: chipLeft + 10, Top: 22, Right: chipLeft + 16, Bottom: 28}, color)
		drawStatusText(hdc, stateLabel, rect{Left: chipLeft + 24, Top: 12, Right: chipLeft + 135, Bottom: 38}, color, 13, fontWeightSemiBold)
	}
	for _, item := range []struct{ name, label string }{{"fit", "Fit"}, {"fullscreen", "Fullscreen"}, {"stats", "Stats"}, {"disconnect", "Disconnect"}} {
		area := layout.buttons[item.name]
		fill, border, text := rgb(18, 21, 26), rgb(37, 42, 50), rgb(226, 232, 240)
		disabled := state != viewerStateConnected && item.name != "disconnect"

		if item.name == "disconnect" && state.terminal() {
			item.label = "Close"
		}
		if item.name == "disconnect" && !state.terminal() {
			fill, border, text = rgb(57, 25, 31), rgb(116, 47, 57), rgb(241, 152, 161)
		}
		if disabled {
			fill, border, text = rgb(15, 17, 21), rgb(29, 34, 41), rgb(83, 91, 103)
		} else if item.name == "fit" && mode == viewerScaleFit || item.name == "stats" && statsOpen || item.name == "fullscreen" && fullscreen {
			fill, border, text = rgb(17, 30, 50), rgb(43, 70, 106), rgb(147, 197, 253)
		}
		if !disabled && hover == item.name {
			border = rgb(96, 165, 250)
			fill = rgb(27, 35, 47)
		}
		if !disabled && pressed == item.name && hover == item.name {
			fill = rgb(43, 70, 106)
		}
		drawStatusRoundRect(hdc, area.toRect(), 16, fill, border)
		drawCenteredStatusText(hdc, item.label, area.toRect(), text, 13, fontWeightSemiBold)
	}
	if statsOpen {
		v.drawStatsPopover(hdc, layout)
	}
}

func (v *viewer) drawStatsPopover(hdc uintptr, layout viewerShellLayout) {
	v.mu.RLock()
	codec, width, height, decoded, presented, backend, state := v.videoCodec, v.screenWidth, v.screenHeight, v.decodedCompleted, v.successfulPresents, v.rendererBackend, v.sessionState
	v.mu.RUnlock()
	panel := rect{Left: int32(layout.video.x + layout.video.width + 12), Top: int32(layout.toolbar.height + 12), Right: int32(layout.toolbar.width - 12), Bottom: int32(layout.toolbar.height + 250)}
	drawStatusRoundRect(hdc, panel, 10, rgb(18, 21, 26), rgb(37, 42, 50))
	drawStatusText(hdc, "Connection stats", rect{Left: panel.Left + 14, Top: panel.Top + 10, Right: panel.Right - 12, Bottom: panel.Top + 32}, rgb(244, 245, 247), 12, fontWeightSemiBold)
	lines := []string{fmt.Sprintf("Connection: %s", state.label()), fmt.Sprintf("Codec: %s", codec), fmt.Sprintf("Remote: %dx%d", width, height), "Target FPS: 30", fmt.Sprintf("Decoded frames: %d", decoded), fmt.Sprintf("Presented frames: %d", presented), fmt.Sprintf("Renderer: %s", backend)}
	for i, line := range lines {
		drawStatusText(hdc, line, rect{Left: panel.Left + 14, Top: panel.Top + 42 + int32(i*26), Right: panel.Right - 12, Bottom: panel.Top + 66 + int32(i*26)}, rgb(174, 181, 191), 13, fontWeightNormal)
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
	if v.localShellKey(message, wparam, lparam) {
		return 0
	}
	v.mu.RLock()
	terminal := v.sessionState.terminal()
	v.mu.RUnlock()
	if terminal && message >= wmMouseMove && message <= wmMouseWheel {
		if message == wmLButtonUp {
			var client rect
			getClientRect.Call(hwnd, uintptr(unsafe.Pointer(&client)))
			if terminalCloseRect(int(client.Right), int(client.Bottom)).contains(int(int16(lparam)), int(int16(lparam>>16))) {
				v.shellAction("disconnect")
			}
		}
		return 0
	}
	switch message {
	case wmEraseBkgnd:
		return 1
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
	width, height := int(client.Right), int(client.Bottom)
	cardWidth := min(480, max(0, width-24))
	card := imageRect{x: (width - cardWidth) / 2, y: (height - 210) / 2, width: cardWidth, height: 210}.toRect()
	drawStatusRoundRect(hdc, card, 24, rgb(18, 21, 26), rgb(37, 42, 50))
	color, detail := rgb(241, 152, 161), "The Remote session ended unexpectedly."
	if state == viewerStateSessionEnded {
		color, detail = rgb(174, 181, 191), "The Remote session has finished."
	}
	drawCenteredStatusText(hdc, state.label(), rect{Left: card.Left + 16, Top: card.Top + 25, Right: card.Right - 16, Bottom: card.Top + 55}, color, 20, fontWeightSemiBold)
	drawCenteredStatusText(hdc, detail, rect{Left: card.Left + 16, Top: card.Top + 65, Right: card.Right - 16, Bottom: card.Top + 90}, rgb(226, 232, 240), 14, fontWeightNormal)
	if state == viewerStateConnectionLost {
		drawCenteredStatusText(hdc, "Start a new Remote session from SentinelGrid.", rect{Left: card.Left + 16, Top: card.Top + 95, Right: card.Right - 16, Bottom: card.Top + 120}, rgb(149, 156, 168), 13, fontWeightNormal)
	}
	button := terminalCloseRect(width, height).toRect()
	drawStatusRoundRect(hdc, button, 16, rgb(17, 30, 50), rgb(43, 70, 106))
	drawCenteredStatusText(hdc, "Close", button, rgb(147, 197, 253), 14, fontWeightSemiBold)
}
