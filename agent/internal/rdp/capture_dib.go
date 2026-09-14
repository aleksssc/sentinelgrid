package rdp

const (
	bitmapInfoHeaderSize = 40
	dibRGBColors         = 0
)

// bitmapInfoHeader is the Win32 BITMAPINFOHEADER layout. Its fields are all
// 32-bit aligned, so it occupies the required 40 bytes on every Go target.
type bitmapInfoHeader struct {
	Size                         uint32
	Width, Height                int32
	Planes, BitCount             uint16
	Compression, SizeImage       uint32
	XPelsPerMeter, YPelsPerMeter int32
	ClrUsed, ClrImportant        uint32
}

// bitmapInfo includes storage for the optional color table. BI_RGB 32-bit DIBs
// do not use it, but BITMAPINFO must provide the trailing RGBQUAD slot.
type bitmapInfo struct {
	Header bitmapInfoHeader
	Colors [1]uint32
}

func newCaptureDIBInfo(width, height int) (bitmapInfo, int, error) {
	pixelSize, err := capturePixelBufferSize(width, height)
	if err != nil {
		return bitmapInfo{}, 0, err
	}
	return bitmapInfo{Header: bitmapInfoHeader{
		Size:        bitmapInfoHeaderSize,
		Width:       int32(width),
		Height:      -int32(height),
		Planes:      1,
		BitCount:    32,
		Compression: 0, // BI_RGB
		// SizeImage is optional for BI_RGB and is calculated by GDI.
	}}, pixelSize, nil
}
