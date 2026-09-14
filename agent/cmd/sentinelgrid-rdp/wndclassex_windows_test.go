//go:build windows && amd64

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unsafe"
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

func TestViewerLoggerWritesWindowLifecycleEvents(t *testing.T) {
	programData := t.TempDir()
	t.Setenv("ProgramData", programData)
	logger := openViewerLogger()
	if logger == nil {
		t.Fatal("openViewerLogger returned nil")
	}
	logger.event("VIEWER_WINDOW_CREATED")
	logger.close()
	data, err := os.ReadFile(filepath.Join(programData, "SentinelGrid", "logs", "viewer.log"))
	if err != nil {
		t.Fatalf("read viewer log: %v", err)
	}
	if !strings.Contains(string(data), "VIEWER_WINDOW_CREATED") {
		t.Fatalf("viewer log does not contain lifecycle event: %q", data)
	}
}
