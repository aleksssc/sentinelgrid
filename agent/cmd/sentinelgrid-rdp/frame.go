package main

import (
	"image"
	"image/color"
)

type viewerFrame struct {
	pixels                []byte // BGRA for a top-down 32bpp BI_RGB DIB.
	width, height, stride int
}

func (f viewerFrame) valid() bool {
	if f.width <= 0 || f.height <= 0 || f.stride <= 0 || f.width > f.stride/4 {
		return false
	}
	return f.height <= len(f.pixels)/f.stride
}

func (f viewerFrame) pixelSummary() (nonZero, variation bool) {
	if !f.valid() {
		return false, false
	}
	first := f.pixels[:3]
	for y := 0; y < f.height; y++ {
		for x := 0; x < f.width; x++ {
			pixel := f.pixels[y*f.stride+x*4 : y*f.stride+x*4+3]
			if pixel[0] != 0 || pixel[1] != 0 || pixel[2] != 0 {
				nonZero = true
			}
			if pixel[0] != first[0] || pixel[1] != first[1] || pixel[2] != first[2] {
				variation = true
			}
			if nonZero && variation {
				return true, true
			}
		}
	}
	return nonZero, variation
}

// imageToBGRA converts directly into the format consumed by StretchDIBits.
// JPEG normally decodes to YCbCr, avoiding the previous intermediate RGBA image.
func imageToBGRA(source image.Image) viewerFrame {
	bounds := source.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	stride := width * 4
	pixels := make([]byte, height*stride)
	if ycbcr, ok := source.(*image.YCbCr); ok && ycbcr.Rect == bounds {
		for y := 0; y < height; y++ {
			for x := 0; x < width; x++ {
				offset := y*stride + x*4
				index := ycbcr.YOffset(x+bounds.Min.X, y+bounds.Min.Y)
				chroma := ycbcr.COffset(x+bounds.Min.X, y+bounds.Min.Y)
				r, g, b := color.YCbCrToRGB(ycbcr.Y[index], ycbcr.Cb[chroma], ycbcr.Cr[chroma])
				pixels[offset], pixels[offset+1], pixels[offset+2], pixels[offset+3] = b, g, r, 0
			}
		}
		return viewerFrame{pixels: pixels, width: width, height: height, stride: stride}
	}
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			r, g, b, _ := source.At(x, y).RGBA()
			offset := (y-bounds.Min.Y)*stride + (x-bounds.Min.X)*4
			pixels[offset], pixels[offset+1], pixels[offset+2], pixels[offset+3] = byte(b>>8), byte(g>>8), byte(r>>8), 0
		}
	}
	return viewerFrame{pixels: pixels, width: width, height: height, stride: stride}
}

func rgbaToBGRA(source *image.RGBA) viewerFrame { return imageToBGRA(source) }

type imageRect struct{ x, y, width, height int }

func fittedImageRect(clientWidth, clientHeight, imageWidth, imageHeight int) (imageRect, bool) {
	if clientWidth < 1 || clientHeight < 1 || imageWidth < 1 || imageHeight < 1 {
		return imageRect{}, false
	}
	width, height := clientWidth, clientWidth*imageHeight/imageWidth
	if height > clientHeight {
		height = clientHeight
		width = clientHeight * imageWidth / imageHeight
	}
	if width < 1 || height < 1 {
		return imageRect{}, false
	}
	return imageRect{x: (clientWidth - width) / 2, y: (clientHeight - height) / 2, width: width, height: height}, true
}

func mapClientPoint(clientWidth, clientHeight, imageWidth, imageHeight, x, y int) (int, int, bool) {
	display, ok := fittedImageRect(clientWidth, clientHeight, imageWidth, imageHeight)
	if !ok || x < display.x || y < display.y || x >= display.x+display.width || y >= display.y+display.height {
		return 0, 0, false
	}
	remoteX := (x - display.x) * (imageWidth - 1) / max(1, display.width-1)
	remoteY := (y - display.y) * (imageHeight - 1) / max(1, display.height-1)
	return remoteX, remoteY, true
}
