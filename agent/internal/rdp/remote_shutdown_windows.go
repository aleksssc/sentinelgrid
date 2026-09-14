//go:build windows

package rdp

import "time"

type remoteInputResult struct {
	normal bool
	err    error
}

// A peer close control frame and the concurrent writer error can arrive in
// either order. Give the sole reader a bounded opportunity to classify it.
func awaitRemoteInputResult(done <-chan remoteInputResult) (remoteInputResult, bool) {
	timer := time.NewTimer(250 * time.Millisecond)
	defer timer.Stop()
	select {
	case result := <-done:
		return result, true
	case <-timer.C:
		return remoteInputResult{}, false
	}
}
