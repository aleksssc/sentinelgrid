package update

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"time"
)

type MSIProgress struct {
	StartedAt              time.Time `json:"started_at"`
	WorkerPID              uint32    `json:"worker_pid,omitempty"`
	WorkerStarted          uint64    `json:"worker_started,omitempty"`
	PreviousPID            uint32    `json:"previous_pid"`
	PreviousProcessStarted uint64    `json:"previous_process_started"`
	ConfigSHA256           string    `json:"config_sha256"`
	ExitCode               *int      `json:"exit_code,omitempty"`
	Detail                 string    `json:"detail,omitempty"`
	RepairRequired         bool      `json:"repair_required,omitempty"`
}

func (p MSIProgress) Validate() error {
	hash, err := hex.DecodeString(p.ConfigSHA256)
	if err != nil || len(hash) != 32 || p.StartedAt.IsZero() || p.PreviousPID == 0 || p.PreviousProcessStarted == 0 || (p.WorkerPID == 0) != (p.WorkerStarted == 0) {
		return fmt.Errorf("invalid MSI process/config identity")
	}
	return nil
}

type MSIResult struct {
	TransactionID string `json:"transaction_id"`
	ExitCode      int    `json:"exit_code"`
	Detail        string `json:"detail"`
}

type MSIHost interface {
	Host
	PrepareMSI(context.Context, State) (*MSIProgress, error)
	LaunchMSI(context.Context, State) error
	MSIResult(context.Context, State) (result *MSIResult, running bool, err error)
	ProductHealthy(context.Context, State) error
}

func failMSI(host MSIHost, state State, detail string, repair bool, cause error) error {
	rememberFailure(&state)
	state.Status, state.Error, state.CompletedAt = "failed", "INSTALL_OR_HEALTH_FAILED", time.Now().UTC()
	if state.MSI != nil {
		state.MSI.Detail, state.MSI.RepairRequired = detail, repair
	}
	log.Printf("UPDATE_FAILED code=%s", detail)
	// Windows Installer alone owns rollback; never restore only the Agent EXE.
	return errors.Join(cause, host.Save(state))
}

func recoverMSILocked(ctx context.Context, host MSIHost, state State) error {
	if state.Pending == nil || state.Pending.Schema != 2 {
		return fmt.Errorf("MSI recovery requires product journal protocol 2")
	}
	switch state.Status {
	case "downloading":
		return failMSI(host, state, "MSI_DOWNLOAD_INTERRUPTED", false, fmt.Errorf("MSI download interrupted"))
	case "staged":
		allowed, err := versionAllowed(state.Previous, state.Target, state)
		if err != nil || !allowed {
			return failMSI(host, state, "MSI_VERSION_REJECTED", false, fmt.Errorf("MSI version is not allowed"))
		}
		if !state.Authorized || !state.Pending.NotAfter.After(time.Now()) {
			return failMSI(host, state, "MSI_AUTHORIZATION_EXPIRED", false, fmt.Errorf("MSI authorization expired"))
		}
		if err := host.Verify(ctx, state.Pending.Release()); err != nil {
			return failMSI(host, state, "MSI_VERIFICATION_FAILED", false, err)
		}
		progress, err := host.PrepareMSI(ctx, state)
		if err != nil {
			return failMSI(host, state, "MSI_PREPARATION_FAILED", false, err)
		}
		state.MSI, state.Status = progress, "installing"
		if err := host.Save(state); err != nil {
			return err
		}
		log.Print("MSI_INSTALL_STARTED")
		if err := host.LaunchMSI(ctx, state); err != nil {
			// A launch acknowledgement may have reached disk. Recovery, not a second launch, resolves it.
			return err
		}
		return nil
	case "installing":
		if state.MSI == nil {
			return fmt.Errorf("MSI installation identity missing")
		}
		result, running, err := host.MSIResult(ctx, state)
		if err != nil && ctx.Err() == nil {
			return failMSI(host, state, "MSI_RESULT_UNREADABLE_REPAIR_REQUIRED", true, err)
		}
		if err != nil || running {
			return err
		}
		if result == nil || result.TransactionID != state.TransactionID {
			return failMSI(host, state, "MSI_RESULT_UNKNOWN_REPAIR_REQUIRED", true, fmt.Errorf("MSI result is unavailable; installer repair required"))
		}
		state.MSI.ExitCode = &result.ExitCode
		log.Printf("MSI_INSTALL_EXIT_CODE code=%d", result.ExitCode)
		if result.Detail != "MSI_FINISHED" {
			return failMSI(host, state, "MSI_COORDINATOR_FAILED", true, fmt.Errorf("MSI coordinator did not record installer completion"))
		}
		if result.ExitCode != 0 && result.ExitCode != 3010 {
			return failMSI(host, state, fmt.Sprintf("MSI_EXIT_%d", result.ExitCode), result.Detail != "MSI_FINISHED", fmt.Errorf("Windows Installer failed with exit code %d", result.ExitCode))
		}
		state.Status = "awaiting_health"
		log.Print("AWAITING_HEALTH")
		if err := host.Save(state); err != nil {
			return err
		}
		return recoverMSILocked(ctx, host, state)
	case "awaiting_health":
		if state.MSI == nil || state.MSI.ExitCode == nil || (*state.MSI.ExitCode != 0 && *state.MSI.ExitCode != 3010) {
			return fmt.Errorf("health cannot precede a successful MSI result")
		}
		if err := host.ProductHealthy(ctx, state); err != nil {
			if ctx.Err() != nil {
				return err
			}
			// A reboot-required MSI is not success. Allow the administrator to reboot, without forcing downtime.
			if *state.MSI.ExitCode == 3010 && time.Since(state.MSI.StartedAt) < 24*time.Hour {
				return err
			}
			return failMSI(host, state, "MSI_PRODUCT_HEALTH_FAILED", true, err)
		}
		state.Status, state.CompletedAt = "succeeded", time.Now().UTC()
		if err := host.Save(state); err != nil {
			return err
		}
		log.Print("UPDATE_SUCCEEDED")
		return host.Commit()
	case "succeeded", "failed":
		return host.Commit()
	default:
		return fmt.Errorf("unexpected MSI journal phase %s", state.Status)
	}
}
