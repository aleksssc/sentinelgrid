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
	createPopupMenu        = viewerUser32.NewProc("CreatePopupMenu")
	appendMenu             = viewerUser32.NewProc("AppendMenuW")
	trackPopupMenu         = viewerUser32.NewProc("TrackPopupMenu")
	destroyMenu            = viewerUser32.NewProc("DestroyMenu")
	getCursorPosShell      = viewerUser32.NewProc("GetCursorPos")
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
	case "input":
		v.showInputMenu()
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

const (
	remoteInputMenuFull       = 4101
	remoteInputMenuView       = 4102
	remoteInputMenuBlockLocal = 4103
	remoteInputMenuCursor     = 4104
	mfString                  = 0x0000
	mfChecked                 = 0x0008
	mfSeparator               = 0x0800
	tpmReturnCmd              = 0x0100
	tpmRightButton            = 0x0002
)

func appendInputMenuItem(menu uintptr, id uintptr, label string, checked bool) {
	text, _ := syscall.UTF16PtrFromString(label)
	flags := uintptr(mfString)
	if checked {
		flags |= mfChecked
	}
	appendMenu.Call(menu, flags, id, uintptr(unsafe.Pointer(text)))
}

func (v *viewer) showInputMenu() {
	v.mu.RLock()
	hwnd := v.hwnd
	mode := v.inputMode
	blocked := v.blockLocalInput
	cursor := v.showRemoteCursor
	connected := v.sessionState == viewerStateConnected
	v.mu.RUnlock()
	if hwnd == 0 || !connected {
		return
	}

	menu, _, _ := createPopupMenu.Call()
	if menu == 0 {
		return
	}
	defer destroyMenu.Call(menu)

	appendInputMenuItem(menu, remoteInputMenuFull, "Full control", mode == "full")
	appendInputMenuItem(menu, remoteInputMenuView, "View only", mode == "view")
	appendMenu.Call(menu, mfSeparator, 0, 0)
	appendInputMenuItem(menu, remoteInputMenuBlockLocal, "Block local keyboard && mouse", blocked)
	appendInputMenuItem(menu, remoteInputMenuCursor, "Show Remote cursor", cursor)

	var p point
	if ok, _, _ := getCursorPosShell.Call(uintptr(unsafe.Pointer(&p))); ok == 0 {
		return
	}
	selected, _, _ := trackPopupMenu.Call(menu, tpmReturnCmd|tpmRightButton, uintptr(p.X), uintptr(p.Y), 0, hwnd, 0)
	if selected == 0 {
		return
	}

	v.mu.Lock()
	switch selected {
	case remoteInputMenuFull:
		v.inputMode = "full"
	case remoteInputMenuView:
		v.inputMode = "view"
	case remoteInputMenuBlockLocal:
		v.blockLocalInput = !v.blockLocalInput
	case remoteInputMenuCursor:
		v.showRemoteCursor = !v.showRemoteCursor
	}
	v.mu.Unlock()

	if v.input != nil && selected == remoteInputMenuView {
		v.input.releaseOnFocusLoss()
	}
	if err := v.sendInputControl(); err != nil {
		v.logger.event("VIEWER_INPUT_CONTROL_SEND_FAILED stage=menu")
	}
	invalidateRect.Call(hwnd, 0, 0, 0)
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
	inputMode, blockLocal := v.inputMode, v.blockLocalInput
	v.mu.RUnlock()

	fillStatusRect(hdc, layout.toolbarRect(), rgb(18, 21, 26))
	fillStatusRect(hdc, rect{Left: 0, Top: int32(layout.toolbar.height - 1), Right: client.Right, Bottom: int32(layout.toolbar.height)}, rgb(31, 36, 43))

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
	if int(chipLeft)+138 < layout.buttons["fit"].x {
		chip := rect{Left: chipLeft, Top: 11, Right: chipLeft + 138, Bottom: 39}
		drawStatusRoundRect(hdc, chip, 18, rgb(11, 14, 17), rgb(31, 36, 43))
		fillStatusEllipse(hdc, rect{Left: chip.Left + 11, Top: chip.Top + 11, Right: chip.Left + 17, Bottom: chip.Top + 17}, color)
		drawStatusText(hdc, stateLabel, rect{Left: chip.Left + 25, Top: chip.Top, Right: chip.Right - 10, Bottom: chip.Bottom}, color, 13, fontWeightSemiBold)
	}

	group := rect{
		Left:   int32(layout.buttons["fit"].x),
		Top:    int32(layout.buttons["fit"].y),
		Right:  int32(layout.buttons["stats"].x + layout.buttons["stats"].width),
		Bottom: int32(layout.buttons["fit"].y + layout.buttons["fit"].height),
	}
	drawStatusRoundRect(hdc, group, 18, rgb(14, 17, 21), rgb(31, 36, 43))

	for _, item := range []struct{ name, label string }{{"fit", "Fit"}, {"fullscreen", "Fullscreen"}, {"stats", "Stats"}} {
		area := layout.buttons[item.name].toRect()
		disabled := state != viewerStateConnected
		active := item.name == "fit" && mode == viewerScaleFit || item.name == "stats" && statsOpen || item.name == "fullscreen" && fullscreen

		fill, text := rgb(14, 17, 21), rgb(210, 216, 225)
		if disabled {
			text = rgb(78, 86, 98)
		} else if active {
			fill, text = rgb(20, 35, 56), rgb(151, 198, 253)
		} else if hover == item.name {
			fill, text = rgb(24, 29, 36), rgb(244, 247, 250)
		}
		if !disabled && pressed == item.name && hover == item.name {
			fill = rgb(31, 49, 73)
		}

		if fill != rgb(14, 17, 21) {
			drawStatusRoundRect(hdc, area, 14, fill, fill)
		}
		drawCenteredStatusText(hdc, item.label, area, text, 13, fontWeightSemiBold)

		if item.name != "stats" {
			dividerX := area.Right
			fillStatusRect(hdc, rect{Left: dividerX - 1, Top: group.Top + 7, Right: dividerX, Bottom: group.Bottom - 7}, rgb(38, 44, 53))
		}
	}

	inputArea := layout.buttons["input"].toRect()
	inputActive := inputMode == "view" || blockLocal
	inputFill, inputBorder, inputText := rgb(14, 17, 21), rgb(31, 36, 43), rgb(210, 216, 225)
	if state != viewerStateConnected {
		inputText = rgb(78, 86, 98)
	} else if inputActive {
		inputFill, inputBorder, inputText = rgb(20, 35, 56), rgb(43, 70, 106), rgb(151, 198, 253)
	} else if hover == "input" {
		inputFill, inputBorder, inputText = rgb(24, 29, 36), rgb(52, 61, 73), rgb(244, 247, 250)
	}
	if state == viewerStateConnected && pressed == "input" && hover == "input" {
		inputFill = rgb(31, 49, 73)
	}
	drawStatusRoundRect(hdc, inputArea, 18, inputFill, inputBorder)
	inputLabel := "Input"
	if inputMode == "view" {
		inputLabel = "View"
	}
	drawCenteredStatusText(hdc, inputLabel+"  ▾", inputArea, inputText, 13, fontWeightSemiBold)

	disconnectArea := layout.buttons["disconnect"].toRect()
	disconnectLabel := "Disconnect"
	if state.terminal() {
		disconnectLabel = "Close"
	}
	disconnectFill, disconnectBorder, disconnectText := rgb(56, 24, 31), rgb(96, 41, 50), rgb(242, 159, 168)
	if hover == "disconnect" {
		disconnectFill, disconnectBorder = rgb(70, 29, 37), rgb(125, 51, 63)
	}
	if pressed == "disconnect" && hover == "disconnect" {
		disconnectFill = rgb(88, 35, 45)
	}
	drawStatusRoundRect(hdc, disconnectArea, 18, disconnectFill, disconnectBorder)
	drawCenteredStatusText(hdc, disconnectLabel, disconnectArea, disconnectText, 13, fontWeightSemiBold)

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
