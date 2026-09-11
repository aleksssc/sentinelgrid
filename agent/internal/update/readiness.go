package update

import (
	"context"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"
)

var stopping atomic.Bool
var probeMu sync.Mutex
var readinessLog struct {
	sync.Mutex
	reason string
}

func BeginShutdown() { stopping.Store(true) }

func dispatchAllowed(ctx context.Context, shutdown, maintenance bool) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if shutdown {
		return fmt.Errorf("Windows or Agent is stopping")
	}
	if maintenance {
		return fmt.Errorf("SentinelGrid MSI maintenance is active")
	}
	return nil
}

type readinessCheck struct {
	name string
	run  func(context.Context) error
}

func evaluateReadiness(ctx context.Context, qualified bool, checks []readinessCheck) error {
	if !qualified {
		return fmt.Errorf("source qualification is disabled")
	}
	for _, check := range checks {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := check.run(ctx); err != nil {
			return fmt.Errorf("%s: %w", check.name, err)
		}
	}
	return nil
}

func Operational() bool {
	probeMu.Lock()
	defer probeMu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	err := operational(ctx)
	reason := ""
	if err != nil {
		reason = err.Error()
	}
	readinessLog.Lock()
	defer readinessLog.Unlock()
	if reason != readinessLog.reason {
		if err != nil {
			log.Printf("Agent updater unavailable: %s", reason)
		} else {
			log.Print("Agent updater operational")
		}
		readinessLog.reason = reason
	}
	return err == nil
}
