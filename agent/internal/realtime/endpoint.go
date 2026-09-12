package realtime

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const maxReconnectDelay = 5 * time.Minute

func nextReconnectDelay(previous time.Duration) time.Duration {
	if previous < reconnectDelay {
		return reconnectDelay
	}
	if previous >= maxReconnectDelay/2 {
		return maxReconnectDelay
	}
	return previous * 2
}

func jitterReconnectDelay(delay time.Duration) time.Duration {
	// Equal jitter avoids synchronized fleets without allowing immediate retries.
	return delay/2 + time.Duration(rand.Int64N(int64(delay/2)+1))
}

func discoverWebSocketURL(ctx context.Context, server string) (string, error) {
	legacy, err := buildWebSocketURL(server)
	if err != nil {
		return "", err
	}
	endpoint, err := url.Parse(legacy)
	if err != nil || endpoint.Host == "" || endpoint.User != nil {
		return "", fmt.Errorf("invalid realtime discovery origin")
	}
	if endpoint.Scheme == "wss" {
		endpoint.Scheme = "https"
	} else if endpoint.Scheme == "ws" && (endpoint.Hostname() == "127.0.0.1" || endpoint.Hostname() == "::1" || endpoint.Hostname() == "localhost") {
		endpoint.Scheme = "http"
	} else {
		return "", fmt.Errorf("realtime discovery requires HTTPS (HTTP is restricted to loopback)")
	}
	endpoint.Path = strings.TrimSuffix(endpoint.Path, "/agent") + "/endpoint"
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return "", fmt.Errorf("create realtime discovery request: %w", err)
	}
	client := &http.Client{
		Timeout: 15 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return fmt.Errorf("realtime discovery redirects are forbidden")
		},
	}
	response, err := client.Do(request)
	if err != nil {
		return "", fmt.Errorf("realtime discovery failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		// Older backends do not expose endpoint negotiation.
		return legacy, nil
	}
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("realtime discovery returned HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 4097))
	if err != nil || len(data) > 4096 {
		return "", fmt.Errorf("invalid realtime discovery response size")
	}
	var body map[string]json.RawMessage
	if err := json.Unmarshal(data, &body); err != nil {
		return "", fmt.Errorf("invalid realtime discovery response")
	}
	value, found := body["origin"]
	if !found {
		return "", fmt.Errorf("realtime discovery response is missing origin")
	}
	if string(value) == "null" {
		return legacy, nil
	}
	var origin string
	if err := json.Unmarshal(value, &origin); err != nil {
		return "", fmt.Errorf("invalid realtime origin")
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Scheme != "wss" || parsed.Hostname() == "" || parsed.User != nil ||
		(parsed.Path != "" && parsed.Path != "/") || parsed.RawPath != "" || parsed.RawQuery != "" || parsed.ForceQuery ||
		parsed.Fragment != "" || strings.ContainsAny(origin, "?#\\\r\n\t ") {
		return "", fmt.Errorf("realtime origin must be a WSS origin without credentials, path, query or fragment")
	}
	parsed.Path = "/api/realtime/agent"
	return parsed.String(), nil
}
