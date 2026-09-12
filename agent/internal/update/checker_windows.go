//go:build windows

package update

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	buildinfo "sentinelgrid/agent"
	"sentinelgrid/agent/internal/config"
)

func Run(ctx context.Context, version string) {
	go reportLoop(ctx)
	startup, err := jitter(3 * time.Minute)
	if err != nil {
		log.Print("Update scheduler random source failed")
		return
	}
	timer := time.NewTimer(time.Minute + startup)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		next, err := scheduledCheck(ctx, version)
		if err != nil && !errors.Is(err, ErrDeferred) {
			log.Printf("Update check failed: %v", err)
		}
		if next < time.Minute {
			next = 6 * time.Hour
		}
		timer.Reset(next)
	}
}

func scheduledCheck(ctx context.Context, version string) (delay time.Duration, resultErr error) {
	extra, err := jitter(2 * time.Hour)
	if err != nil {
		return 6 * time.Hour, err
	}
	delay = 5*time.Hour + extra
	ready := Operational()
	host, err := NewWindowsHost(ctx)
	if err != nil {
		return delay, err
	}
	unlock, err := host.Lock()
	if err != nil {
		return delay, err
	}
	defer func() { resultErr = errors.Join(resultErr, host.ClosePins(), unlock()) }()
	path := filepath.Join(host.Root, "schedule.json")
	var schedule struct {
		Next time.Time `json:"next_check"`
	}
	err = readMetadata(path, &schedule)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return delay, err
	}
	if err == nil && time.Now().Before(schedule.Next) {
		remaining := time.Until(schedule.Next)
		if remaining > 7*time.Hour {
			remaining = 7 * time.Hour
		}
		return remaining, nil
	}
	schedule.Next = time.Now().Add(delay)
	if err := atomicJSON(path, schedule); err != nil {
		return delay, err
	}
	return delay, host.checkAndStage(ctx, version, "", ready)
}

func RequestUpdate(ctx context.Context, commandID string) (resultErr error) {
	if !commandPattern.MatchString(commandID) {
		return fmt.Errorf("invalid update command identity")
	}
	if !Operational() {
		return fmt.Errorf("secure updater is not operational")
	}
	host, err := NewWindowsHost(ctx)
	if err != nil {
		return err
	}
	unlock, err := host.Lock()
	if err != nil {
		return err
	}
	defer func() { resultErr = errors.Join(resultErr, host.ClosePins(), unlock()) }()
	return host.checkAndStage(ctx, buildinfo.Version(), commandID, true)
}

func (h *WindowsHost) checkAndStage(ctx context.Context, version, commandID string, ready bool) (resultErr error) {
	if err := h.CanDispatch(ctx); err != nil {
		return err
	}
	state, err := h.Load()
	if err != nil {
		return err
	}
	if commandID != "" && state.CommandID == commandID {
		return ErrDeferred
	}
	if !availableForStage(state) {
		return fmt.Errorf("update journal is reserved or awaiting terminal report")
	}
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("update check waiting for valid Agent config")
	}
	checkedAt := time.Now()
	release, err := fetchRelease(ctx, cfg)
	if err != nil {
		return err
	}
	allowed, err := versionAllowed(version, release.Version, state)
	if err != nil {
		return err
	}
	if !release.Available || !allowed {
		if commandID != "" {
			return noUpdateReason(version, release.Version, release.Available)
		}
		return nil
	}
	if !ready || !release.InstallationEnabled || (commandID == "" && !release.Automatic) {
		if commandID != "" {
			return errInstallationDisabled
		}
		return updateRequest(ctx, cfg, "/api/agent/update/report", map[string]string{"update_status": "available", "update_target_version": release.Version, "update_error": "UPDATER_NOT_OPERATIONAL"}, nil)
	}
	if err := release.Validate(); err != nil {
		return err
	}
	if err := h.Commit(); err != nil {
		return err
	}
	id, err := newTransactionID()
	if err != nil {
		return err
	}
	state = State{Status: "downloading", Target: release.Version, Previous: version, TransactionID: id, CommandID: commandID,
		FailedVersion: state.FailedVersion, FailedVersions: state.FailedVersions, StartedAt: time.Now().UTC()}
	if err := h.Save(state); err != nil {
		return err
	}
	published := false
	defer func() {
		if !published && resultErr != nil {
			log.Printf("Update staging failed before dispatch: %v", resultErr)
			rememberFailure(&state)
			state.Status, state.Error, state.CompletedAt = "failed", "INSTALL_OR_HEALTH_FAILED", time.Now().UTC()
			if saveErr := h.Save(state); saveErr != nil {
				resultErr = errors.Join(ErrDeferred, resultErr, saveErr)
			} else {
				reportCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
				reportErr := reportState(reportCtx, cfg, state)
				cancel()
				if reportErr != nil {
					log.Printf("Update failure delivery deferred: %v", reportErr)
				}
				resultErr = errors.Join(ErrDeferred, resultErr)
			}
		}
	}()
	if err := reportState(ctx, cfg, state); err != nil {
		return err
	}
	if err := Download(ctx, release, filepath.Join(h.Root, "candidate.exe"), VerifySignature); err != nil {
		return err
	}
	if err := h.Verify(ctx, release); err != nil {
		return err
	}
	// The existing check API permits one policy lookup per minute. Revalidate
	// after download without adding a rate-limit bypass or persisting the URL.
	if remaining := time.Until(checkedAt.Add(61 * time.Second)); remaining > 0 {
		timer := time.NewTimer(remaining)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timer.C:
		}
	}
	fresh, err := fetchRelease(ctx, cfg)
	if err != nil {
		return err
	}
	if !fresh.Available || !fresh.InstallationEnabled || (commandID == "" && !fresh.Automatic) ||
		fresh.Version != release.Version || fresh.Channel != release.Channel || fresh.SHA256 != release.SHA256 || fresh.Size != release.Size {
		return fmt.Errorf("trusted release policy changed before dispatch")
	}
	if err := h.CanDispatch(ctx); err != nil {
		return err
	}
	if err := h.checkRecovery(ctx); err != nil {
		return err
	}
	if err := handoffLocked(ctx, h, state, fresh, func(pending State) error {
		return reportState(ctx, cfg, pending)
	}, h.CanDispatch); err != nil {
		return err
	}
	published = true
	return ErrDeferred
}

func RecordHeartbeat(version string) {
	if !sourceQualified() {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := recordHeartbeat(ctx, version); err != nil {
		log.Printf("Update health confirmation failed: %v", err)
	}
}

func recordHeartbeat(ctx context.Context, version string) error {
	host, err := NewWindowsHost(ctx)
	if err != nil {
		return err
	}
	state, err := host.Load()
	if err != nil {
		return err
	}
	if state.TransactionID == "" || !Active(state) || (version != state.Target && version != state.Previous) {
		return nil
	}
	if _, err := config.Load(); err != nil {
		return fmt.Errorf("health requires valid configuration")
	}
	created, err := processIdentity(uint32(os.Getpid()), filepath.Join(host.InstallDir, "SentinelGridAgent.exe"))
	if err != nil {
		return err
	}
	return atomicJSON(filepath.Join(host.Root, "health.json"), Health{Version: version, PID: uint32(os.Getpid()), ProcessStarted: created, TransactionID: state.TransactionID, At: time.Now().UTC()})
}

func reportState(ctx context.Context, cfg *config.Config, state State) error {
	body := map[string]string{"update_status": state.Status, "update_target_version": state.Target}
	if state.Error != "" {
		body["update_error"] = state.Error
	}
	if state.TransactionID != "" {
		body["transaction_id"] = state.TransactionID
	}
	if state.CommandID != "" {
		body["command_id"] = state.CommandID
	}
	return updateRequest(ctx, cfg, "/api/agent/update/report", body, nil)
}

func reportLoop(ctx context.Context) {
	if !sourceQualified() {
		return
	}
	timer := time.NewTicker(30 * time.Second)
	defer timer.Stop()
	for {
		if err := reportTerminal(ctx); err != nil && ctx.Err() == nil {
			log.Printf("Update result delivery pending: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
	}
}

func reportTerminal(ctx context.Context) (resultErr error) {
	host, err := NewWindowsHost(ctx)
	if err != nil {
		return err
	}
	unlock, err := host.Lock()
	if err != nil {
		return err
	}
	defer func() { resultErr = errors.Join(resultErr, unlock()) }()
	state, err := host.Load()
	if err != nil {
		return err
	}
	if state.TransactionID == "" || state.Reported || state.CompletedAt.IsZero() {
		return nil
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if err := reportState(ctx, cfg, state); err != nil {
		return err
	}
	state.Reported = true
	return host.Save(state)
}
