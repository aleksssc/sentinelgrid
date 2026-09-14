package main

import (
	"errors"
	"testing"
	"time"
)

func TestRendererPresentAccountingClearsLoadingOnlyAfterSuccess(t *testing.T) {
	viewer := &viewer{logger: &viewerLogger{}, status: "Starting video...", presentMetrics: newDurationWindow(8)}
	viewer.recordRendererResult(errors.New("present failed"), 1, time.Millisecond)
	if viewer.successfulPresents != 0 || viewer.lastSuccessfulGeneration != 0 || viewer.status != "Starting video..." {
		t.Fatalf("failed present changed visible state: %#v", viewer)
	}
	viewer.recordRendererResult(nil, 2, 2*time.Millisecond)
	if viewer.presentAttempts != 2 || viewer.successfulPresents != 1 || viewer.lastSuccessfulGeneration != 2 || viewer.status != "" {
		t.Fatalf("successful present was not recorded: %#v", viewer)
	}
	if got := viewer.presentMetrics.snapshot(); got.count != 1 || got.avg != 2*time.Millisecond {
		t.Fatalf("present timing = %#v, want one successful sample", got)
	}
}
