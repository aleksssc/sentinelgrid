package rdp

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"sync/atomic"
	"time"

	"sentinelgrid/agent/internal/config"
)

var controlAvailable atomic.Bool
var wake = make(chan struct{}, 1)

func Wake() {
	select {
	case wake <- struct{}{}:
	default:
	}
}
func HeartbeatControl(pending *bool) {
	controlAvailable.Store(pending != nil)
	if pending != nil && *pending {
		Wake()
	}
}

func Run(ctx context.Context) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-wake:
		case <-ticker.C:
			if controlAvailable.Load() {
				continue
			}
		}
		if err := Available(ctx); err != nil {
			log.Printf("[RDP] remote host unavailable: %v", err)
			continue
		}
		cfg, err := config.Load()
		if err != nil {
			log.Printf("[RDP] configuration unavailable: %v", err)
			continue
		}
		if err := poll(ctx, cfg); err != nil && ctx.Err() == nil {
			log.Printf("[RDP] %v", err)
		}
	}
}

func poll(ctx context.Context, cfg *config.Config) error {
	base, err := url.Parse(cfg.Server)
	if err != nil || base.Scheme != "https" || base.Host == "" || base.User != nil || base.RawQuery != "" || base.Fragment != "" {
		return fmt.Errorf("RDP requires an HTTPS enrolled server")
	}
	base.Path = "/api/agent/rdp"
	requestCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodPost, base.String(), nil)
	if err != nil {
		return fmt.Errorf("RDP request creation failed")
	}
	request.Header.Set("Authorization", "Bearer "+cfg.AgentToken)
	response, err := (&http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}).Do(request)
	if err != nil {
		return fmt.Errorf("RDP control plane unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNoContent {
		return nil
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("RDP control plane rejected request (%d)", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 2049))
	if err != nil || len(data) > 2048 {
		return fmt.Errorf("invalid RDP control response")
	}
	var connection Connection
	if json.Unmarshal(data, &connection) != nil || connection.Validate() != nil {
		return fmt.Errorf("invalid RDP control response")
	}
	log.Print("[RDP] authorized remote-control session received")
	sessionCtx, cancelSession := context.WithDeadline(ctx, connection.ExpiresAt)
	defer cancelSession()
	if err := LaunchInteractive(sessionCtx, connection); err != nil {
		return fmt.Errorf("remote host failed: %w", err)
	}
	return nil
}
