package update

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"sentinelgrid/agent/internal/config"
)

// ErrDeferred means the durable journal, not the terminating process, owns the result.
var ErrDeferred = errors.New("update result deferred until authenticated health validation")

func jitter(max time.Duration) (time.Duration, error) {
	var data [8]byte
	if _, err := rand.Read(data[:]); err != nil {
		return 0, err
	}
	return time.Duration(binary.LittleEndian.Uint64(data[:]) % uint64(max)), nil
}

func updateRequest(ctx context.Context, cfg *config.Config, path string, body any, target any) error {
	u, err := url.Parse(cfg.Server)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("update API requires HTTPS configuration")
	}
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	u.Path = path
	client := &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return fmt.Errorf("update API redirects forbidden") }}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("could not create update request")
	}
	request.Header.Set("Authorization", "Bearer "+cfg.AgentToken)
	request.Header.Set("Content-Type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("update API network failure")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("update API returned HTTP %d", response.StatusCode)
	}
	if target == nil {
		return nil
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 16384)).Decode(target); err != nil {
		return fmt.Errorf("invalid update API response")
	}
	return nil
}

func fetchRelease(ctx context.Context, cfg *config.Config) (Release, error) {
	var release Release
	if err := updateRequest(ctx, cfg, "/api/agent/update/check", struct{}{}, &release); err != nil {
		return release, err
	}
	if release.Product != "SentinelGridAgent" || release.Platform != "windows" || release.Architecture != "amd64" {
		return release, fmt.Errorf("unexpected update service response")
	}
	if _, err := EffectiveChannel(release.Channel, nil); err != nil {
		return release, err
	}
	if _, err := parseVersion(release.Version); err != nil {
		return release, err
	}
	return release, nil
}
