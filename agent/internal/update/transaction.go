package update

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// Production gate: development eligibility uses a separate build tag and pin.
const Qualified = false
const maxRecoveryAttempts = 3

type State struct {
	Status         string    `json:"update_status"`
	Target         string    `json:"update_target_version,omitempty"`
	Previous       string    `json:"previous_version,omitempty"`
	FailedVersion  string    `json:"failed_version,omitempty"`
	FailedVersions []string  `json:"failed_versions,omitempty"`
	StartedAt      time.Time `json:"update_started_at,omitempty"`
	CompletedAt    time.Time `json:"update_completed_at,omitempty"`
	Error          string    `json:"update_error,omitempty"`
	NextCheck      time.Time `json:"next_check,omitempty"`
	TransactionID  string    `json:"transaction_id,omitempty"`
	CommandID      string    `json:"command_id,omitempty"`
	Pending        *Pending  `json:"pending,omitempty"`
	Attempts       int       `json:"recovery_attempts,omitempty"`
	Reported       bool      `json:"reported,omitempty"`
	Authorized     bool      `json:"authorized,omitempty"`
}

// Host implementations must keep a durable backup until Commit succeeds.
// Restore must be idempotent, including after an interrupted Replace.
type Host interface {
	Lock() (func() error, error)
	Load() (State, error)
	Save(State) error
	Verify(context.Context, Release) error
	Stop(context.Context) error
	Backup() error
	Replace() error
	Start(context.Context) error
	Healthy(context.Context, string) error
	Restore() error
	Commit() error
}

func rollback(ctx context.Context, host Host, state State, cause error) error {
	if ctx.Err() != nil {
		return errors.Join(cause, ctx.Err())
	}
	rememberFailure(&state)
	if state.Attempts >= maxRecoveryAttempts {
		state.Status, state.Error, state.CompletedAt = "failed", "ROLLBACK_FAILED", time.Now().UTC()
		return errors.Join(cause, host.Save(state))
	}
	state.Attempts++
	state.Status, state.Error, state.CompletedAt = "failed", "INSTALL_OR_HEALTH_FAILED", time.Time{}
	if err := host.Save(state); err != nil {
		return errors.Join(cause, err)
	}
	// Service shutdown cancels this context; boot recovery owns the durable intent.
	ctx, cancel := context.WithTimeout(ctx, 4*time.Minute)
	defer cancel()
	steps := []func() error{
		func() error { return host.Stop(ctx) },
		host.Restore,
		func() error { return host.Start(ctx) },
		func() error { return host.Healthy(ctx, state.Previous) },
	}
	for _, step := range steps {
		if err := ctx.Err(); err != nil {
			return errors.Join(cause, err)
		}
		if err := step(); err != nil {
			if ctx.Err() != nil && !errors.Is(ctx.Err(), context.DeadlineExceeded) {
				return errors.Join(cause, err)
			}
			if state.Attempts >= maxRecoveryAttempts {
				state.Error, state.CompletedAt = "ROLLBACK_FAILED", time.Now().UTC()
			}
			return errors.Join(cause, fmt.Errorf("rollback failed: %w", err), host.Save(state))
		}
	}
	state.Status, state.CompletedAt = "rolled_back", time.Now().UTC()
	if err := host.Save(state); err != nil {
		return errors.Join(cause, err)
	}
	return errors.Join(cause, host.Commit())
}

// RecoverLocked never resumes an unvalidated replacement after a crash. The
// caller must own the same lock used by staging and hold it until recovery ends.
func RecoverLocked(ctx context.Context, host Host, state State) error {
	switch state.Status {
	case "downloading", "staged":
		rememberFailure(&state)
		state.Status, state.Error, state.CompletedAt = "failed", "INSTALL_OR_HEALTH_FAILED", time.Now().UTC()
		if err := host.Save(state); err != nil {
			return err
		}
		return host.Commit()
	case "installing", "restarting", "failed":
		if state.Status == "failed" && !state.CompletedAt.IsZero() {
			return nil
		}
		return rollback(ctx, host, state, fmt.Errorf("recovering interrupted update"))
	default:
		return nil
	}
}

func Install(ctx context.Context, host Host, current string, release Release) (resultErr error) {
	unlock, err := host.Lock()
	if err != nil {
		return err
	}
	defer func() { resultErr = errors.Join(resultErr, unlock()) }()
	state, err := host.Load()
	if err != nil {
		return err
	}
	return installLocked(ctx, host, state, current, release)
}

func installLocked(ctx context.Context, host Host, state State, current string, release Release) error {
	switch state.Status {
	case "installing", "restarting":
		return RecoverLocked(ctx, host, state)
	case "failed":
		if state.CompletedAt.IsZero() || state.Error == "ROLLBACK_FAILED" {
			return RecoverLocked(ctx, host, state)
		}
	case "staged":
		if state.Target != release.Version {
			return fmt.Errorf("another update is staged")
		}
	}
	allowed, err := versionAllowed(current, release.Version, state)
	if err != nil {
		return err
	}
	if !allowed {
		return fmt.Errorf("update version is not allowed")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := host.Verify(ctx, release); err != nil {
		return err
	}
	state.Status, state.Target, state.Previous = "staged", release.Version, current
	state.StartedAt, state.CompletedAt, state.Error = time.Now().UTC(), time.Time{}, ""
	if err := host.Save(state); err != nil {
		return err
	}
	if err := host.Backup(); err != nil {
		rememberFailure(&state)
		state.Status, state.Error, state.CompletedAt = "failed", "BACKUP_FAILED", time.Now().UTC()
		return errors.Join(err, host.Save(state))
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	state.Status = "installing"
	if err := host.Save(state); err != nil {
		return err
	}
	if err := host.Stop(ctx); err != nil {
		return rollback(ctx, host, state, err)
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := host.Replace(); err != nil {
		return rollback(ctx, host, state, err)
	}
	state.Status = "restarting"
	if err := host.Save(state); err != nil {
		return rollback(ctx, host, state, err)
	}
	if err := host.Start(ctx); err != nil {
		return rollback(ctx, host, state, err)
	}
	if err := host.Healthy(ctx, release.Version); err != nil {
		return rollback(ctx, host, state, err)
	}
	state.Status, state.CompletedAt = "succeeded", time.Now().UTC()
	if err := host.Save(state); err != nil {
		return rollback(ctx, host, state, err)
	}
	return host.Commit()
}
