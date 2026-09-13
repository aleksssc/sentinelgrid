package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const MaxArtifactSize int64 = 256 * 1024 * 1024

type Release struct {
	ArtifactType        string    `json:"artifact_type,omitempty"`
	SignerSHA256        string    `json:"signer_sha256,omitempty"`
	UpdateProtocol      int       `json:"update_protocol,omitempty"`
	Product             string    `json:"product"`
	Version             string    `json:"latest_version"`
	Channel             string    `json:"channel"`
	Platform            string    `json:"platform"`
	Architecture        string    `json:"architecture"`
	DownloadURL         string    `json:"download_url,omitempty"`
	SHA256              string    `json:"sha256"`
	Size                int64     `json:"size_bytes"`
	ExpiresAt           time.Time `json:"expires_at"`
	Available           bool      `json:"update_available"`
	Automatic           bool      `json:"automatic_updates"`
	InstallationEnabled bool      `json:"installation_enabled"`
}

type SignatureVerifier func(context.Context, string) error

func (r Release) Validate() error {
	if r.ArtifactType != "" && (r.ArtifactType != "msi" || r.UpdateProtocol != 2 || !validSignerPins(r.SignerSHA256, true)) {
		return fmt.Errorf("unsupported or unqualified installation artifact")
	}
	if r.Product != "SentinelGridAgent" || r.Platform != "windows" || r.Architecture != "amd64" {
		return fmt.Errorf("unexpected release identity")
	}
	if _, err := parseVersion(r.Version); err != nil {
		return err
	}
	if _, err := EffectiveChannel(r.Channel, nil); err != nil {
		return err
	}
	hash, err := hex.DecodeString(r.SHA256)
	if err != nil || len(hash) != sha256.Size || r.Size <= 0 || r.Size > MaxArtifactSize {
		return fmt.Errorf("invalid artifact hash or size")
	}
	return nil
}

func VerifyArtifact(ctx context.Context, path string, r Release, signature SignatureVerifier) error {
	if err := r.Validate(); err != nil {
		return err
	}
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open artifact: %w", err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() != r.Size {
		return fmt.Errorf("artifact size/type mismatch")
	}
	hash := sha256.New()
	if _, err := io.Copy(hash, io.LimitReader(file, MaxArtifactSize+1)); err != nil {
		return fmt.Errorf("hash artifact: %w", err)
	}
	if !strings.EqualFold(hex.EncodeToString(hash.Sum(nil)), r.SHA256) {
		return fmt.Errorf("SHA256 mismatch")
	}
	if signature == nil {
		return fmt.Errorf("signature verifier required")
	}
	return signature(ctx, path)
}

func Download(ctx context.Context, r Release, destination string, signature SignatureVerifier) (resultErr error) {
	if err := r.Validate(); err != nil {
		return err
	}
	u, err := url.Parse(r.DownloadURL)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" || !time.Now().Before(r.ExpiresAt) {
		return fmt.Errorf("invalid or expired HTTPS download")
	}
	client := &http.Client{Timeout: 10 * time.Minute, CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
		return fmt.Errorf("artifact redirects forbidden")
	}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, r.DownloadURL, nil)
	if err != nil {
		return fmt.Errorf("could not create download request")
	}
	response, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("artifact download network failure")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("artifact download returned HTTP %d", response.StatusCode)
	}
	file, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return fmt.Errorf("create staging file: %w", err)
	}
	defer func() {
		if resultErr != nil {
			if err := os.Remove(destination); err != nil {
				resultErr = fmt.Errorf("%w; staging cleanup failed: %v", resultErr, err)
			}
		}
	}()
	n, copyErr := io.Copy(file, io.LimitReader(response.Body, r.Size+1))
	syncErr := file.Sync()
	closeErr := file.Close()
	if copyErr != nil || syncErr != nil || closeErr != nil || n != r.Size {
		return fmt.Errorf("artifact download incomplete")
	}
	return VerifyArtifact(ctx, destination, r, signature)
}
