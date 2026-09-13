//go:build windows

package update

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"
)

// RunRecovery has no network input and executes only the fixed Agent transaction.
// SCM restarts a crashed process; durable attempt counts survive those restarts.
func RunRecovery(ctx context.Context) {
	first := true
	timer := time.NewTicker(10 * time.Second)
	defer timer.Stop()
	for {
		if sourceQualified() {
			scanned, err := recoveryPass(ctx, first)
			if scanned {
				first = false
			}
			if err != nil && ctx.Err() == nil {
				log.Printf("Agent update recovery: %v", err)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
	}
}

func recoveryPass(ctx context.Context, first bool) (scanned bool, resultErr error) {
	host, err := NewWindowsHost(ctx)
	if err != nil {
		return false, err
	}
	if err := host.recoveryIdentity(ctx); err != nil {
		return false, err
	}
	unlock, err := host.Lock()
	if err != nil {
		return false, err
	}
	defer func() { resultErr = errors.Join(resultErr, host.ClosePins(), unlock()) }()
	state, err := host.Load()
	if err != nil {
		return true, err
	}
	if state.Error == "ROLLBACK_FAILED" {
		return true, nil
	}
	if state.Pending != nil && state.Pending.Schema == 2 {
		return true, recoverMSILocked(ctx, host, state)
	}
	if err := host.CanDispatch(ctx); err != nil {
		return true, err
	}
	if first || state.Status == "installing" || state.Status == "restarting" || (state.Status == "failed" && state.CompletedAt.IsZero()) || state.Status == "downloading" {
		return true, RecoverLocked(ctx, host, state)
	}
	if state.Status != "staged" {
		return true, host.Commit()
	}
	if !state.Authorized || state.Pending == nil || !state.Pending.NotAfter.After(time.Now()) {
		return true, RecoverLocked(ctx, host, state)
	}
	current, err := host.CurrentVersion(ctx)
	if err != nil || current != state.Previous {
		return true, errors.Join(fmt.Errorf("installed Agent changed after handoff"), RecoverLocked(ctx, host, state))
	}
	installCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	if err := installLocked(installCtx, host, state, current, state.Pending.Release()); err != nil {
		latest, loadErr := host.Load()
		if loadErr == nil && latest.Status == "staged" && ctx.Err() == nil {
			return true, errors.Join(err, RecoverLocked(ctx, host, latest))
		}
		return true, errors.Join(err, loadErr)
	}
	return true, nil
}
