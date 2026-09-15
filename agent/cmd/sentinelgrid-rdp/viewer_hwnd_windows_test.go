//go:build windows

package main

import (
	"runtime"
	"syscall"
	"testing"
	"unsafe"
)

func TestViewerHiddenHWNDFullscreenResizeAndStats(t *testing.T) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	previous := activeViewer
	v := &viewer{sessionState: viewerStateConnecting}
	activeViewer = v
	defer func() { activeViewer = previous }()
	instance, _, _ := getModuleHandle.Call(0)
	name, _ := syscall.UTF16PtrFromString("SentinelGridViewerLifecycleTest")
	callback := syscall.NewCallback(func(hwnd uintptr, message uint32, wparam, lparam uintptr) uintptr {
		if message == wmDestroy {
			return 0
		}
		return viewerProc(hwnd, message, wparam, lparam)
	})
	wc := wndClassEx{Size: uint32(unsafe.Sizeof(wndClassEx{})), WndProc: callback, Instance: instance, ClassName: name, Background: getStockObjectValue(blackBrush)}
	if atom, _, err := registerClassEx.Call(uintptr(unsafe.Pointer(&wc))); atom == 0 {
		t.Fatalf("register test window: %v", err)
	}
	defer viewerUser32.NewProc("UnregisterClassW").Call(uintptr(unsafe.Pointer(name)), instance)
	hwnd, _, err := createWindowEx.Call(0, uintptr(unsafe.Pointer(name)), 0, wsOverlappedWindow|0x02000000, 120, 140, 900, 650, 0, 0, instance, 0)
	if hwnd == 0 {
		t.Fatalf("create hidden parent: %v", err)
	}
	defer viewerUser32.NewProc("DestroyWindow").Call(hwnd)
	childClass, _ := syscall.UTF16PtrFromString("STATIC")
	child, _, err := createWindowEx.Call(0, uintptr(unsafe.Pointer(childClass)), 0, wsChild, 0, 0, 1, 1, hwnd, 0, instance, 0)
	if child == 0 {
		t.Fatalf("create video host placeholder: %v", err)
	}
	v.hwnd, v.videoHost = hwnd, child
	v.layoutShell(hwnd)
	var original rect
	viewerUser32.NewProc("GetWindowRect").Call(hwnd, uintptr(unsafe.Pointer(&original)))
	for cycle := 0; cycle < 5; cycle++ {
		v.toggleFullscreen()
		if !v.fullscreen {
			t.Fatal("fullscreen did not enter")
		}
		v.toggleFullscreen()
		if v.fullscreen {
			t.Fatal("fullscreen did not exit")
		}
		var restored rect
		viewerUser32.NewProc("GetWindowRect").Call(hwnd, uintptr(unsafe.Pointer(&restored)))
		if restored != original {
			t.Fatalf("cycle %d restored %+v, want %+v", cycle, restored, original)
		}
		if v.videoHost != child {
			t.Fatal("video host was recreated")
		}
		var client rect
		getClientRect.Call(hwnd, uintptr(unsafe.Pointer(&client)))
		if v.shell.video.width != int(client.Right) || v.shell.video.height != int(client.Bottom)-viewerToolbarHeight {
			t.Fatalf("stale dimensions: %+v", v.shell.video)
		}
		v.shellAction("stats")
		if v.shell.video.width != int(client.Right)-272 {
			t.Fatal("stats reservation incorrect")
		}
		v.shellAction("stats")
		if v.shell.video.width != int(client.Right) {
			t.Fatal("stats did not restore viewport")
		}
	}
	v.sessionState = viewerStateNegotiatingVideo
	v.frameGeneration = 1
	moveWindow.Call(child, 0, 0, 0, 0, 1)
	v.presentLatestFrame(child)
	if v.notification.lastAttemptedGeneration != 0 || v.sessionState != viewerStateNegotiatingVideo {
		t.Fatal("zero-size video host consumed first presentation")
	}

}

func TestViewerShellIgnoresSelfRemoteTaggedCloseKeys(t *testing.T) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	setExtra := viewerUser32.NewProc("SetMessageExtraInfo")
	previous, _, _ := setExtra.Call(sentinelGridInputTag)
	defer setExtra.Call(previous)
	v := &viewer{sessionState: viewerStateConnected}
	if !v.localShellKey(wmSysKeyDown, 0x73, 1<<29) || v.wasCloseRequested() {
		t.Fatal("self-remote tagged Alt+F4 closed the local Viewer")
	}
}
