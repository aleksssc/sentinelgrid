//go:build windows

package rdp

import (
	"context"
	"fmt"
	"sync/atomic"
	"time"
)

type remoteHostLoopState uint32

const (
	remoteHostLoopIdle remoteHostLoopState = iota
	remoteHostLoopVideoTick
	remoteHostLoopCapture
	remoteHostLoopEncode
	remoteHostLoopEnqueue
	remoteHostLoopWriterFailure
	remoteHostLoopResolveWriterFailure
	remoteHostLoopWaitingInputShutdown
	remoteHostLoopShutdown
)

func (s remoteHostLoopState) String() string {
	switch s {
	case remoteHostLoopVideoTick:
		return "video_tick"
	case remoteHostLoopCapture:
		return "capture"
	case remoteHostLoopEncode:
		return "encode"
	case remoteHostLoopEnqueue:
		return "enqueue"
	case remoteHostLoopWriterFailure:
		return "writer_failure"
	case remoteHostLoopResolveWriterFailure:
		return "resolve_writer_failure"
	case remoteHostLoopWaitingInputShutdown:
		return "waiting_input_shutdown"
	case remoteHostLoopShutdown:
		return "shutdown"
	default:
		return "idle"
	}
}

type remoteHostLoopWatchdog struct {
	progress, videoTick, capture, encoded, queued, writerCompletion, inputPacket, statsTick atomic.Int64
	state                                                                                   atomic.Uint32
}

func newRemoteHostLoopWatchdog() *remoteHostLoopWatchdog {
	w := &remoteHostLoopWatchdog{}
	w.progress.Store(time.Now().UnixNano())
	return w
}

func (w *remoteHostLoopWatchdog) advance(state remoteHostLoopState) {
	w.state.Store(uint32(state))
	w.progress.Store(time.Now().UnixNano())
}
func (w *remoteHostLoopWatchdog) markVideoTick() {
	w.videoTick.Store(time.Now().UnixNano())
	w.advance(remoteHostLoopVideoTick)
}
func (w *remoteHostLoopWatchdog) markCapture() {
	w.capture.Store(time.Now().UnixNano())
	w.advance(remoteHostLoopCapture)
}
func (w *remoteHostLoopWatchdog) markEncoded() {
	w.encoded.Store(time.Now().UnixNano())
	w.advance(remoteHostLoopEncode)
}
func (w *remoteHostLoopWatchdog) markQueued() {
	w.queued.Store(time.Now().UnixNano())
	w.advance(remoteHostLoopEnqueue)
}
func (w *remoteHostLoopWatchdog) markWriterCompletion() {
	w.writerCompletion.Store(time.Now().UnixNano())
	w.advance(remoteHostLoopIdle)
}
func (w *remoteHostLoopWatchdog) markInputPacket() {
	w.inputPacket.Store(time.Now().UnixNano())
	w.advance(remoteHostLoopIdle)
}
func (w *remoteHostLoopWatchdog) markStatsTick() {
	w.statsTick.Store(time.Now().UnixNano())
	w.advance(remoteHostLoopIdle)
}

func startRemoteHostLoopWatchdog(ctx context.Context, logger *remoteLogger, watchdog *remoteHostLoopWatchdog) <-chan struct{} {
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(250 * time.Millisecond)
		defer ticker.Stop()
		var reportedAt int64
		var lastReport time.Time
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-ticker.C:
				progress := watchdog.progress.Load()
				if progress == 0 {
					continue
				}
				duration := now.Sub(time.Unix(0, progress))
				if duration < time.Second {
					if reportedAt != 0 {
						logger.event(fmt.Sprintf("REMOTE_HOST_STALL_RECOVERED state=%s duration_ms=%d", remoteHostLoopState(watchdog.state.Load()), duration.Milliseconds()))
						reportedAt = 0
						lastReport = time.Time{}
					}
					continue
				}
				if reportedAt != progress || now.Sub(lastReport) >= 5*time.Second {
					logger.event(fmt.Sprintf("REMOTE_HOST_STALL state=%s duration_ms=%d video_tick_ms=%d capture_ms=%d encoded_ms=%d queued_ms=%d writer_completion_ms=%d input_packet_ms=%d stats_tick_ms=%d", remoteHostLoopState(watchdog.state.Load()), duration.Milliseconds(), ageMilliseconds(now, watchdog.videoTick.Load()), ageMilliseconds(now, watchdog.capture.Load()), ageMilliseconds(now, watchdog.encoded.Load()), ageMilliseconds(now, watchdog.queued.Load()), ageMilliseconds(now, watchdog.writerCompletion.Load()), ageMilliseconds(now, watchdog.inputPacket.Load()), ageMilliseconds(now, watchdog.statsTick.Load())))
					reportedAt = progress
					lastReport = now
				}
			}
		}
	}()
	return done
}

func ageMilliseconds(now time.Time, timestamp int64) int64 {
	if timestamp == 0 {
		return -1
	}
	return now.Sub(time.Unix(0, timestamp)).Milliseconds()
}
