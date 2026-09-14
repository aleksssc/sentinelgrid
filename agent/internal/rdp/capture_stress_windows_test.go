//go:build windows

package rdp

import (
	"bytes"
	"image/jpeg"
	"testing"

	"golang.org/x/sys/windows"
)

var getGUIResourcesForTest = user32.NewProc("GetGuiResources")

func currentGDIObjectCount() int {
	count, _, _ := getGUIResourcesForTest.Call(uintptr(windows.CurrentProcess()), 0)
	return int(count)
}

func TestCapturePrimaryJPEGRepeated(t *testing.T) {
	before := currentGDIObjectCount()
	for i := 0; i < 100; i++ {
		frame, err := capturePrimaryJPEG()
		if err != nil {
			t.Fatalf("capture %d: %v", i, err)
		}
		if len(frame) == 0 {
			t.Fatalf("capture %d returned an empty JPEG", i)
		}
		if _, err := jpeg.Decode(bytes.NewReader(frame)); err != nil {
			t.Fatalf("capture %d returned an invalid JPEG: %v", i, err)
		}
	}
	after := currentGDIObjectCount()
	if before >= 0 && after > before+1 {
		t.Fatalf("GDI object count grew from %d to %d after repeated captures", before, after)
	}
}
