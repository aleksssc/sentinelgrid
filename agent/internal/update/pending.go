package update

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"time"
)

var transactionPattern = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`)
var commandPattern = regexp.MustCompile(`^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$`)

// Pending deliberately has no network credentials, URL, path or execution options.
// It is embedded in the journal so publishing ownership requires one durable write.
type Pending struct {
	Schema   int       `json:"schema"`
	Version  string    `json:"version"`
	Channel  string    `json:"channel"`
	SHA256   string    `json:"sha256"`
	Size     int64     `json:"size_bytes"`
	NotAfter time.Time `json:"not_after"`
}

func (p Pending) Release() Release {
	return Release{Product: "SentinelGridAgent", Platform: "windows", Architecture: "amd64", Version: p.Version, Channel: p.Channel, SHA256: p.SHA256, Size: p.Size}
}

func (p Pending) Validate() error {
	if p.Schema != 1 {
		return fmt.Errorf("unsupported pending schema")
	}
	if p.NotAfter.IsZero() {
		return fmt.Errorf("missing dispatch policy expiry")
	}
	return p.Release().Validate()
}

func newTransactionID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6], b[8] = (b[6]&15)|64, (b[8]&63)|128
	x := hex.EncodeToString(b[:])
	return x[:8] + "-" + x[8:12] + "-" + x[12:16] + "-" + x[16:20] + "-" + x[20:], nil
}

func strictJSON(data []byte, target any) error {
	if len(data) > 16384 {
		return fmt.Errorf("update metadata too large")
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if err := d.Decode(target); err != nil {
		return fmt.Errorf("invalid update metadata")
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return fmt.Errorf("trailing update metadata")
	}
	return nil
}

func (s State) Validate() error {
	switch s.Status {
	case "", "idle", "available", "downloading", "staged", "installing", "restarting", "failed", "succeeded", "rolled_back":
	default:
		return fmt.Errorf("invalid journal state")
	}
	for _, v := range append([]string{s.Target, s.Previous, s.FailedVersion}, s.FailedVersions...) {
		if v != "" {
			if _, err := parseVersion(v); err != nil {
				return err
			}
		}
	}
	if len(s.FailedVersions) > 128 || s.Attempts < 0 || s.Attempts > maxRecoveryAttempts {
		return fmt.Errorf("invalid recovery bounds")
	}
	if s.TransactionID != "" && !transactionPattern.MatchString(s.TransactionID) {
		return fmt.Errorf("invalid transaction identity")
	}
	if s.CommandID != "" && (!commandPattern.MatchString(s.CommandID) || s.TransactionID == "") {
		return fmt.Errorf("invalid command correlation")
	}
	if s.Pending != nil {
		if err := s.Pending.Validate(); err != nil {
			return err
		}
		if s.TransactionID == "" || s.Target != s.Pending.Version {
			return fmt.Errorf("pending journal mismatch")
		}
	}
	if s.Status == "staged" && s.Pending == nil {
		return fmt.Errorf("missing verified pending metadata")
	}
	if Active(s) && (s.Target == "" || s.Previous == "") {
		return fmt.Errorf("missing recovery versions")
	}
	if s.Target != "" && s.Previous != "" {
		c, err := CompareVersions(s.Target, s.Previous)
		if err != nil || c <= 0 {
			return fmt.Errorf("journal downgrade or replay")
		}
	}
	return nil
}

func Active(s State) bool {
	switch s.Status {
	case "downloading", "staged", "installing", "restarting":
		return true
	case "failed":
		return s.CompletedAt.IsZero() || s.Error == "ROLLBACK_FAILED"
	}
	return false
}

func availableForStage(s State) bool {
	return !Active(s) && (s.TransactionID == "" || s.Reported) && len(s.FailedVersions) < 128
}

func versionAllowed(current, target string, s State) (bool, error) {
	for _, failed := range append([]string{s.FailedVersion}, s.FailedVersions...) {
		allowed, err := ShouldUpdate(current, target, failed)
		if err != nil || !allowed {
			return false, err
		}
	}
	return true, nil
}

func rememberFailure(s *State) {
	s.FailedVersion = s.Target
	for _, v := range s.FailedVersions {
		if v == s.Target {
			return
		}
	}
	if len(s.FailedVersions) < 128 {
		s.FailedVersions = append(s.FailedVersions, s.Target)
	}
}
