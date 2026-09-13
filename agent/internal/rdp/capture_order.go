package rdp

import "fmt"

type capturePhase uint8

const (
	captureUnselected capturePhase = iota
	captureSelected
	captureCopied
	captureRestored
	captureRead
)

// captureOrder makes the required GDI bitmap lifetime explicit: GetDIBits may
// only run after the bitmap has been deselected from the memory device context.
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
	if o.phase != captureCopied {
		return fmt.Errorf("bitmap restore requires completed BitBlt")
	}
	o.phase = captureRestored
	return nil
}

func (o *captureOrder) read() error {
	if o.phase != captureRestored {
		return fmt.Errorf("GetDIBits requires restored bitmap")
	}
	o.phase = captureRead
	return nil
}
