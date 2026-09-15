package main

type viewerScaleMode uint8

const (
	viewerScaleFit viewerScaleMode = iota
	viewerScaleActual
)

type viewerShellLayout struct {
	toolbar imageRect
	video   imageRect
	buttons map[string]imageRect
}

const viewerToolbarHeight = 50

func viewerLayoutForClient(width, height int) viewerShellLayout {
	toolbarHeight := min(viewerToolbarHeight, max(0, height))
	layout := viewerShellLayout{
		toolbar: imageRect{width: max(0, width), height: toolbarHeight},
		video:   imageRect{y: toolbarHeight, width: max(0, width), height: max(0, height-toolbarHeight)},
		buttons: make(map[string]imageRect),
	}
	// Compact controls are placed from the right edge so the product and device
	// labels retain priority in narrow windows.
	x := width - 12
	for _, item := range []struct {
		name  string
		width int
	}{{"disconnect", 86}, {"stats", 52}, {"fullscreen", 82}, {"fit", 42}} {
		x -= item.width
		layout.buttons[item.name] = imageRect{x: x, y: 9, width: item.width, height: 32}
		x -= 6
	}
	return layout
}

func (l viewerShellLayout) actionAt(x, y int) string {
	for _, name := range []string{"fit", "fullscreen", "stats", "disconnect"} {
		area := l.buttons[name]
		if x >= area.x && y >= area.y && x < area.x+area.width && y < area.y+area.height {
			return name
		}
	}
	return ""
}

func actualSizeRect(viewportWidth, viewportHeight, imageWidth, imageHeight int) (imageRect, bool) {
	if viewportWidth < 1 || viewportHeight < 1 || imageWidth < 1 || imageHeight < 1 || imageWidth > viewportWidth || imageHeight > viewportHeight {
		return imageRect{}, false
	}
	return imageRect{x: (viewportWidth - imageWidth) / 2, y: (viewportHeight - imageHeight) / 2, width: imageWidth, height: imageHeight}, true
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
