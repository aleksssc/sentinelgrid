package rdp

import (
	"testing"
	"unsafe"
)

func TestCaptureDIBInfoUsesTopDown32BitRGBLayout(t *testing.T) {
	info, pixelSize, err := newCaptureDIBInfo(1920, 1080)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := unsafe.Sizeof(bitmapInfoHeader{}), uintptr(bitmapInfoHeaderSize); got != want {
		t.Fatalf("BITMAPINFOHEADER size = %d, want %d", got, want)
	}
	if got, want := unsafe.Sizeof(bitmapInfo{}), uintptr(44); got != want {
		t.Fatalf("BITMAPINFO size = %d, want %d", got, want)
	}
	if info.Header.Size != bitmapInfoHeaderSize || info.Header.Width != 1920 || info.Header.Height != -1080 || info.Header.Planes != 1 || info.Header.BitCount != 32 || info.Header.Compression != 0 || info.Header.SizeImage != 0 {
		t.Fatalf("unexpected DIB header: %+v", info.Header)
	}
	if pixelSize != 1920*1080*captureBytesPerPixel {
		t.Fatalf("pixel size = %d", pixelSize)
	}
}

func TestCaptureDIBInfoRejectsInvalidDimensions(t *testing.T) {
	if _, _, err := newCaptureDIBInfo(0, 1080); err == nil {
		t.Fatal("invalid DIB dimensions were accepted")
	}
}
