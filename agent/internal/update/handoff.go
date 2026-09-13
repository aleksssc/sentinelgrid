package update

import (
	"context"
	"fmt"
	"time"
)

// Both callers retain Host.Lock across this entire operation. Active journal
// state reserves ownership during the subsequent handle-release/service gap.
func handoffLocked(ctx context.Context, host Host, state State, release Release, authorize func(State) error, canDispatch func(context.Context) error) error {
	if err := release.Validate(); err != nil {
		return err
	}
	if !release.ExpiresAt.After(time.Now()) || release.ExpiresAt.After(time.Now().Add(15*time.Minute)) {
		return fmt.Errorf("invalid dispatch policy expiry")
	}
	if state.Status != "downloading" || state.TransactionID == "" || state.Target != release.Version {
		return fmt.Errorf("invalid handoff transaction")
	}
	if err := state.Validate(); err != nil {
		return err
	}
	if err := canDispatch(ctx); err != nil {
		return err
	}
	if err := host.Verify(ctx, release); err != nil {
		return err
	}
	state.Status = "staged"
	state.Pending = &Pending{Schema: 1, Version: release.Version, Channel: release.Channel, SHA256: release.SHA256, Size: release.Size, NotAfter: release.ExpiresAt}
	if release.ArtifactType == "msi" {
		state.Pending.Schema, state.Pending.ArtifactType, state.Pending.SignerSHA256 = 2, "msi", release.SignerSHA256
	}
	if err := host.Save(state); err != nil {
		return err
	}
	if err := authorize(state); err != nil {
		return err
	}
	if err := canDispatch(ctx); err != nil {
		return err
	}
	if err := host.Verify(ctx, release); err != nil {
		return err
	}
	state.Authorized = true
	return host.Save(state)
}

func cleanupNames(state State) []string {
	if state.MSI != nil && state.MSI.RepairRequired {
		return nil
	}
	if Active(state) || state.CompletedAt.IsZero() {
		return nil
	}
	if state.Status != "succeeded" && state.Status != "rolled_back" && state.Status != "failed" {
		return nil
	}
	if state.Pending != nil && state.Pending.Schema == 2 {
		return []string{"candidate.msi", "msi-result.json", "msi-outcome.json"}
	}
	return []string{"previous.exe", "candidate.exe", "pending.json"}
}
