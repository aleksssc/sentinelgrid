package update

import "errors"

var (
	errAlreadyCurrent       = errors.New("Agent already has the latest permitted version")
	errNoEligibleRelease    = errors.New("no eligible Agent release is currently available")
	errReleaseBlocked       = errors.New("newer Agent release is blocked by failed-release protection")
	errInstallationDisabled = errors.New("trusted update policy disables installation")
)

// Called only after the existing eligibility checks have rejected installation.
func noUpdateReason(current, target string, available bool) error {
	comparison, err := CompareVersions(target, current)
	if err != nil {
		return err
	}
	if comparison <= 0 {
		return errAlreadyCurrent
	}
	if !available {
		return errNoEligibleRelease
	}
	return errReleaseBlocked
}

func CommandErrorCode(err error) string {
	if err == nil {
		return ""
	}
	// Do not hide additional journal/lock cleanup errors joined by RequestUpdate.
	switch err.Error() {
	case errAlreadyCurrent.Error():
		return "NO_NEWER_AGENT_VERSION"
	case errNoEligibleRelease.Error():
		return "NO_ELIGIBLE_AGENT_RELEASE"
	case errReleaseBlocked.Error():
		return "UPDATE_RELEASE_BLOCKED"
	case errInstallationDisabled.Error():
		return "UPDATE_POLICY_DISABLED"
	default:
		return "UPDATE_FAILED"
	}
}
