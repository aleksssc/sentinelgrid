package rdp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
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
		if response != nil && response.Body != nil {
			response.Body.Close()
		}
		return nil, fmt.Errorf("RDP relay connection failed")
	}
	conn.SetReadLimit(64 * 1024)
	conn.SetReadDeadline(time.Now().Add(65 * time.Second))
	stop := context.AfterFunc(ctx, func() { conn.Close() })
	defer stop()
	kind, data, err := conn.ReadMessage()
	var ready struct {
		Type string `json:"type"`
	}
	if err != nil || kind != websocket.TextMessage || json.Unmarshal(data, &ready) != nil || ready.Type != "ready" {
		conn.Close()
		return nil, fmt.Errorf("RDP relay pairing failed")
	}
	conn.SetReadDeadline(c.ExpiresAt)
	return conn, nil
}

func Bridge(ctx context.Context, ws *websocket.Conn, tcp net.Conn) error {
	stop := context.AfterFunc(ctx, func() { ws.Close(); tcp.Close() })
	defer stop()
	defer ws.Close()
	defer tcp.Close()
	done := make(chan error, 1)
	go func() {
		defer ws.Close()
		buffer := make([]byte, 32*1024)
		for {
			n, err := tcp.Read(buffer)
			if n > 0 {
				ws.SetWriteDeadline(time.Now().Add(15 * time.Second))
				if writeErr := ws.WriteMessage(websocket.BinaryMessage, buffer[:n]); writeErr != nil {
					done <- writeErr
					return
				}
			}
			if err != nil {
				done <- err
				return
			}
		}
	}()
	var result error
	for {
		kind, data, err := ws.ReadMessage()
		if err != nil {
			result = err
			break
		}
		if kind != websocket.BinaryMessage {
			result = fmt.Errorf("non-binary RDP data rejected")
			break
		}
		tcp.SetWriteDeadline(time.Now().Add(15 * time.Second))
		if _, err := io.Copy(tcp, bytes.NewReader(data)); err != nil {
			result = err
			break
		}
	}
	ws.Close()
	tcp.Close()
	tcpErr := <-done
	if errors.Is(tcpErr, io.EOF) || errors.Is(result, io.EOF) || websocket.IsCloseError(result, websocket.CloseNormalClosure, websocket.CloseGoingAway) || ctx.Err() != nil {
		return nil
	}
	return fmt.Errorf("RDP transport closed unexpectedly")
}
