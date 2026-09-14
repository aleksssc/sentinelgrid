package main

import "image"

type viewerFrame struct {
	pixels        []byte // BGRA for a top-down 32bpp BI_RGB DIB.
	width, height int
}

func rgbaToBGRA(source *image.RGBA) viewerFrame {
	bounds := source.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	pixels := make([]byte, width*height*4)
	for y := 0; y < height; y++ {
		sourceOffset := source.PixOffset(bounds.Min.X, bounds.Min.Y+y)
		destinationOffset := y * width * 4
		for x := 0; x < width; x++ {
			r, g, b := source.Pix[sourceOffset], source.Pix[sourceOffset+1], source.Pix[sourceOffset+2]
			pixels[destinationOffset], pixels[destinationOffset+1], pixels[destinationOffset+2], pixels[destinationOffset+3] = b, g, r, 0
			sourceOffset += 4
			destinationOffset += 4
		}
	}
	return viewerFrame{pixels: pixels, width: width, height: height}
}

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
