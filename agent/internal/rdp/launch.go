package rdp

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const DefaultRemoteServer = "https://sentinelgrid-one.vercel.app"

func ParseLaunchURI(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "sentinelgrid" || u.Host != "remote" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.RawPath != "" {
		return "", fmt.Errorf("invalid SentinelGrid Remote link")
	}
	if !strings.HasPrefix(u.Path, "/") || strings.Count(u.Path, "/") != 1 {
		return "", fmt.Errorf("invalid SentinelGrid Remote link")
	}
	token := strings.TrimPrefix(u.Path, "/")
	if !ticketPattern.MatchString(token) {
		return "", fmt.Errorf("invalid SentinelGrid Remote link")
	}
	return token, nil
}

func RedeemLaunch(ctx context.Context, server, token string) (Connection, error) {
	if _, err := ParseLaunchURI("sentinelgrid://remote/" + token); err != nil {
		return Connection{}, err
	}
	base, err := url.Parse(server)
	if err != nil || base.Scheme != "https" || base.Host == "" || base.User != nil || base.RawQuery != "" || base.Fragment != "" {
		return Connection{}, fmt.Errorf("invalid SentinelGrid server")
	}
	base.Path = "/api/remote/rdp/launch/redeem"
	data, _ := json.Marshal(map[string]string{"token": token})
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, base.String(), strings.NewReader(string(data)))
	if err != nil {
		return Connection{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	response, err := (&http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}).Do(request)
	if err != nil {
		return Connection{}, fmt.Errorf("SentinelGrid Remote launch failed")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return Connection{}, fmt.Errorf("SentinelGrid Remote link expired or unavailable")
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 2049))
	if err != nil || len(body) > 2048 {
		return Connection{}, fmt.Errorf("invalid SentinelGrid Remote launch response")
	}
	var connection Connection
	if json.Unmarshal(body, &connection) != nil || connection.Version != 1 || connection.Validate() != nil {
		return Connection{}, fmt.Errorf("invalid SentinelGrid Remote launch response")
	}
	return connection, nil
}
