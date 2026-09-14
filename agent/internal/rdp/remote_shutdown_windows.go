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

// remoteSessionController is the sole authority for the terminal session
// result. A writer failure is only provisional until the reader has classified
// the peer close; this removes scheduler ordering from normal-close handling.
type remoteSessionController struct {
	ws            *websocket.Conn
	writer        *latestFrameWriter
	cancelCapture context.CancelFunc
	inputDone     <-chan remoteInputResult
	stopOnce      sync.Once
}

func (c *remoteSessionController) stop() {
	c.stopOnce.Do(func() {
		c.cancelCapture()
		c.writer.close()
		_ = c.ws.Close()
	})
}

// finish stops every producer, releases a blocked reader, and waits for its
// terminal event before allowing the session result to escape.
func (c *remoteSessionController) finish(inputConsumed bool) remoteInputResult {
	c.stop()
	if inputConsumed {
		return remoteInputResult{}
	}
	return <-c.inputDone
}

// resolveWriteFailure preserves a genuine transport failure, but only after
// the reader has conclusively ruled out the peer's normal close control frame.
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
