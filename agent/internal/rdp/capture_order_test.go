package rdp

import "testing"

func TestCaptureOrderRequiresBitmapRestoreBeforeRead(t *testing.T) {
	var order captureOrder
	if err := order.selected(); err != nil {
		t.Fatal(err)
	}
	if err := order.copied(); err != nil {
		t.Fatal(err)
	}
	if err := order.read(); err == nil {
		t.Fatal("GetDIBits was allowed while bitmap remained selected")
	}
	if err := order.restored(); err != nil {
		t.Fatal(err)
	}
	if err := order.read(); err != nil {
		t.Fatal(err)
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
