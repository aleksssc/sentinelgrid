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

const remoteWriteTimeout = 15 * time.Second

var ticketPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

type websocketWriteConn interface {
	SetWriteDeadline(time.Time) error
	WriteMessage(int, []byte) error
}

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

// writePacket gives every individual Remote WebSocket write a fresh bounded
// deadline. Net.Conn deadlines persist after successful writes, so callers
// must never rely on a deadline established by an earlier packet.
func writePacket(ws websocketWriteConn, packet []byte) error {
	return writePacketAt(ws, packet, time.Now)
}

func writePacketAt(ws websocketWriteConn, packet []byte, now func() time.Time) error {
	if err := ws.SetWriteDeadline(now().Add(remoteWriteTimeout)); err != nil {
		return err
	}
	return ws.WriteMessage(websocket.BinaryMessage, packet)
}

// WritePacket is the Viewer-facing form of the Remote bounded-write policy.
func WritePacket(ws *websocket.Conn, packet []byte) error {
	return writePacket(ws, packet)
}
