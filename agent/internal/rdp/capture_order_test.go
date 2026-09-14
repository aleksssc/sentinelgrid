package rdp

import "testing"

func TestCaptureOrderRequiresBitmapRestoreBeforePixels(t *testing.T) {
	var order captureOrder
	if err := order.selected(); err != nil {
		t.Fatal(err)
	}
	if err := order.copied(); err != nil {
		t.Fatal(err)
	}
	if err := order.pixelsReady(); err == nil {
		t.Fatal("DIB pixels were allowed while bitmap remained selected")
	}
	if err := order.restored(); err != nil {
		t.Fatal(err)
	}
	if err := order.pixelsReady(); err != nil {
		t.Fatal(err)
	}
}

func TestCaptureOrderRestoresAfterBitBltFailure(t *testing.T) {
	order := captureOrder{phase: captureSelected}
	if err := order.restored(); err != nil {
		t.Fatalf("selected bitmap was not restorable: %v", err)
	}
}

func TestCaptureOrderRejectsDoubleRestore(t *testing.T) {
	order := captureOrder{phase: captureCopied}
	if err := order.restored(); err != nil {
		t.Fatal(err)
	}
	if err := order.restored(); err == nil {
		t.Fatal("double bitmap restore was allowed")
	}
}
