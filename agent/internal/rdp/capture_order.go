package rdp

import "fmt"

type capturePhase uint8

const (
	captureUnselected capturePhase = iota
	captureSelected
	captureCopied
	captureRestored
	capturePixelsReady
)

// captureOrder makes the bitmap lifetime explicit: it is restored to the
// memory DC before its DIB-section pixels are read or the bitmap is deleted.
type captureOrder struct {
	phase capturePhase
}

func (o *captureOrder) selected() error {
	if o.phase != captureUnselected {
		return fmt.Errorf("bitmap selected in invalid capture phase")
	}
	o.phase = captureSelected
	return nil
}

func (o *captureOrder) copied() error {
	if o.phase != captureSelected {
		return fmt.Errorf("BitBlt requires selected bitmap")
	}
	o.phase = captureCopied
	return nil
}

func (o *captureOrder) restored() error {
	if o.phase != captureSelected && o.phase != captureCopied {
		return fmt.Errorf("bitmap restore requires selected bitmap")
	}
	o.phase = captureRestored
	return nil
}

func (o *captureOrder) pixelsReady() error {
	if o.phase != captureRestored {
		return fmt.Errorf("DIB pixels require restored bitmap")
	}
	o.phase = capturePixelsReady
	return nil
}
