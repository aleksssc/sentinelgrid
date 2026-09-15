//go:build windows

package rdp

import (
	"context"
	"testing"
	"time"
)

func TestRemoteHostLoopWatchdogTracksProgressAndMilestones(t *testing.T) {
	watchdog := newRemoteHostLoopWatchdog()
	before := watchdog.progress.Load()
	watchdog.markVideoTick()
	watchdog.markCapture()
	watchdog.markEncoded()
	watchdog.markQueued()
	watchdog.markWriterCompletion()
	watchdog.markInputPacket()
	watchdog.markStatsTick()
	if watchdog.progress.Load() < before || watchdog.videoTick.Load() == 0 || watchdog.capture.Load() == 0 || watchdog.encoded.Load() == 0 || watchdog.queued.Load() == 0 || watchdog.writerCompletion.Load() == 0 || watchdog.inputPacket.Load() == 0 || watchdog.statsTick.Load() == 0 {
		t.Fatalf("watchdog milestones were not recorded: %#v", watchdog)
	}
	if got := remoteHostLoopState(watchdog.state.Load()); got != remoteHostLoopIdle {
		t.Fatalf("state = %s, want idle", got)
	}
}

func TestRemoteHostLoopWatchdogStopsWithSession(t *testing.T) {
	watchdog := newRemoteHostLoopWatchdog()
	ctx, cancel := context.WithCancel(context.Background())
	done := startRemoteHostLoopWatchdog(ctx, nil, watchdog)
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("watchdog did not stop after session cancellation")
	}
}

func TestRemoteHostLoopStateNamesAreDiagnostic(t *testing.T) {
	if remoteHostLoopResolveWriterFailure.String() != "resolve_writer_failure" || remoteHostLoopWaitingInputShutdown.String() != "waiting_input_shutdown" || ageMilliseconds(time.Now(), 0) != -1 {
		t.Fatal("watchdog diagnostic state is incomplete")
	}
}
