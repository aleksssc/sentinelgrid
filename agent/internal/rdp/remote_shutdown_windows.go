//go:build windows

package rdp

import (
	"context"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type remoteInputResult struct {
	normal bool
	err    error
}
type remotePacketWriter interface {
	beginShutdown()
	close()
}

// remoteSessionController is the sole authority for the terminal session result.
type remoteSessionController struct {
	ws            *websocket.Conn
	writer        remotePacketWriter
	cancelCapture context.CancelFunc
	inputDone     <-chan remoteInputResult
	stopOnce      sync.Once
}

func (c *remoteSessionController) stop() {
	c.stopOnce.Do(func() { c.cancelCapture(); c.writer.close(); _ = c.ws.Close() })
}
func (c *remoteSessionController) finish(inputConsumed bool) remoteInputResult {
	c.stop()
	if inputConsumed {
		return remoteInputResult{}
	}
	return <-c.inputDone
}
func (c *remoteSessionController) resolveWriteFailure(_ context.Context, failure frameWriteResult) error {
	if failure.normal {
		c.stop()
		return nil
	}
	// A normal peer close can race the writer failure. Give the input reader one
	// bounded opportunity to classify it, then close the shared socket ourselves.
	timer := time.NewTimer(250 * time.Millisecond)
	defer timer.Stop()
	select {
	case result := <-c.inputDone:
		c.finish(true)
		if result.normal {
			return nil
		}
	case <-timer.C:
		c.stop()
	}
	return remoteHostFailure("frame-send", failure.err)
}
