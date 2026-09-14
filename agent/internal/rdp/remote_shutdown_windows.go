//go:build windows

package rdp

import (
	"context"
	"sync"

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
func (c *remoteSessionController) resolveWriteFailure(ctx context.Context, failure frameWriteResult) error {
	if failure.normal {
		c.finish(false)
		return nil
	}
	c.writer.beginShutdown()
	select {
	case result := <-c.inputDone:
		c.finish(true)
		if result.normal {
			return nil
		}
		return remoteHostFailure("frame-send", failure.err)
	case <-ctx.Done():
		c.finish(false)
		return nil
	}
}
