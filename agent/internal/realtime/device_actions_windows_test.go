//go:build windows

package realtime

import (
	"context"
	"testing"
	"time"
)

func TestFixedCommandCapturesSeparateOutputAndExitCode(t *testing.T) {
	result, err := runFixedCommand(context.Background(), 10*time.Second, "cmd.exe", "/D", "/C", "echo output & echo error 1>&2 & exit /b 7")
	if err == nil || result["exit_code"] != 7 || result["stdout"] == "" || result["stderr"] == "" {
		t.Fatalf("result lost: %+v %v", result, err)
	}
	result, err = runFixedCommand(context.Background(), 10*time.Second, "cmd.exe", "/D", "/C", "exit /b 0")
	if err != nil || result["exit_code"] != 0 {
		t.Fatalf("successful command rejected: %+v %v", result, err)
	}
}

func TestFixedCommandHasBoundedCancellationAndOutput(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := runFixedCommand(ctx, time.Second, "cmd.exe", "/D", "/C", "exit /b 0"); err == nil {
		t.Fatal("cancelled execution succeeded")
	}
	buffer := &limitedBuffer{limit: 4096}
	_, _ = buffer.Write(make([]byte, 10000))
	if !buffer.truncated || len(buffer.String()) > 4200 {
		t.Fatal("output not bounded")
	}
}
