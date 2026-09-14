//go:build windows && amd64

package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unsafe"

	"github.com/gorilla/websocket"
)

func TestWndClassExWindowsAMD64Layout(t *testing.T) {
	var value wndClassEx
	if size := unsafe.Sizeof(value); size != 80 {
		t.Fatalf("sizeof(WNDCLASSEXW) = %d, want 80", size)
	}
	fields := []struct {
		name string
		off  uintptr
		want uintptr
	}{
		{"Size", unsafe.Offsetof(value.Size), 0},
		{"Style", unsafe.Offsetof(value.Style), 4},
		{"WndProc", unsafe.Offsetof(value.WndProc), 8},
		{"ClsExtra", unsafe.Offsetof(value.ClsExtra), 16},
		{"WndExtra", unsafe.Offsetof(value.WndExtra), 20},
		{"Instance", unsafe.Offsetof(value.Instance), 24},
		{"Icon", unsafe.Offsetof(value.Icon), 32},
		{"Cursor", unsafe.Offsetof(value.Cursor), 40},
		{"Background", unsafe.Offsetof(value.Background), 48},
		{"MenuName", unsafe.Offsetof(value.MenuName), 56},
		{"ClassName", unsafe.Offsetof(value.ClassName), 64},
		{"IconSmall", unsafe.Offsetof(value.IconSmall), 72},
	}
	for _, field := range fields {
		if field.off != field.want {
			t.Errorf("offsetof(%s) = %d, want %d", field.name, field.off, field.want)
		}
	}
}

func TestViewerLoggerWritesLifecycleEventsInUserOwnedDirectory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "SentinelGrid", "logs", "viewer.log")
	logger, err := openViewerLoggerAt([]string{path})
	if err != nil {
		t.Fatalf("open viewer logger: %v", err)
	}
	logger.event("VIEWER_START")
	logger.event("VIEWER_REDEEM_FAILED stage=redeem")
	logger.event("VIEWER_EXIT")
	logger.close()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read viewer log: %v", err)
	}
	for _, event := range []string{"VIEWER_START", "VIEWER_REDEEM_FAILED stage=redeem", "VIEWER_EXIT"} {
		if !strings.Contains(string(data), event) {
			t.Errorf("viewer log does not contain %q: %q", event, data)
		}
	}
}

func TestRelayCloseCategoryIsSanitized(t *testing.T) {
	cases := []struct {
		code int
		want string
	}{
		{websocket.CloseNormalClosure, "normal"},
		{websocket.CloseGoingAway, "going_away"},
		{websocket.ClosePolicyViolation, "policy"},
		{websocket.CloseMessageTooBig, "message_too_big"},
		{websocket.CloseAbnormalClosure, "abnormal"},
		{1011, "websocket_close"},
	}
	for _, tc := range cases {
		err := errors.New("wrapped: " + (&websocket.CloseError{Code: tc.code, Text: "sensitive details"}).Error())
		if got := relayCloseCategory(&websocket.CloseError{Code: tc.code, Text: err.Error()}); got != tc.want {
			t.Errorf("close code %d category = %q, want %q", tc.code, got, tc.want)
		}
	}
}

func TestViewerLoggerNilFileIsNonFatal(t *testing.T) {
	logger := &viewerLogger{}
	logger.event("VIEWER_START")
	logger.close()
}
