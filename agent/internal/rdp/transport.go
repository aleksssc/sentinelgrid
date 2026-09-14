package rdp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"time"

	"github.com/gorilla/websocket"
)

var ticketPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

type Connection struct {
	Version   int       `json:"version,omitempty"`
	Relay     string    `json:"relay"`
	Ticket    string    `json:"ticket"`
	ExpiresAt time.Time `json:"expires_at"`
}

// PairingError classifies connection setup without exposing ticket or relay data.
type PairingError struct {
	Category string
	err      error
}

func (e *PairingError) Error() string { return e.err.Error() }
func (e *PairingError) Unwrap() error { return e.err }

func pairingCategory(err error) string {
	var pairing *PairingError
	if errors.As(err, &pairing) {
		return pairing.Category
	}
	return "unknown"
}

func (c Connection) Validate() error {
	u, err := url.Parse(c.Relay)
	if err != nil || u.Scheme != "wss" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.RawPath != "" || u.Fragment != "" || u.Path != "/rdp" || !ticketPattern.MatchString(c.Ticket) {
		return fmt.Errorf("invalid RDP connection")
	}
	if !c.ExpiresAt.After(time.Now()) || c.ExpiresAt.After(time.Now().Add(121*time.Minute)) {
		return fmt.Errorf("RDP connection expired or invalid lifetime")
	}
	return nil
}

func Dial(ctx context.Context, c Connection) (*websocket.Conn, error) {
	if err := c.Validate(); err != nil {
		return nil, err
	}
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	conn, response, err := dialer.DialContext(ctx, c.Relay, http.Header{"Authorization": {"Bearer " + c.Ticket}})
	if err != nil {
		category := "handshake"
		if ctx.Err() != nil {
			category = "cancelled"
		} else if response != nil {
			category = "rejected"
		}
		if response != nil && response.Body != nil {
			response.Body.Close()
		}
		return nil, &PairingError{Category: category, err: fmt.Errorf("RDP relay connection failed")}
	}
	conn.SetReadLimit(maxRemotePacket)
	conn.SetReadDeadline(time.Now().Add(65 * time.Second))
	kind, data, err := conn.ReadMessage()
	var ready struct {
		Type string `json:"type"`
	}
	if err != nil || kind != websocket.TextMessage || json.Unmarshal(data, &ready) != nil || ready.Type != "ready" {
		conn.Close()
		category := "ready_timeout"
		if err != nil {
			category = "ready_read"
		} else if kind != websocket.TextMessage || ready.Type != "ready" {
			category = "ready_invalid"
		}
		return nil, &PairingError{Category: category, err: fmt.Errorf("RDP relay pairing failed")}
	}
	conn.SetReadDeadline(c.ExpiresAt)
	return conn, nil
}

func writePacket(ws *websocket.Conn, packet []byte) error {
	ws.SetWriteDeadline(time.Now().Add(15 * time.Second))
	return ws.WriteMessage(websocket.BinaryMessage, packet)
}
