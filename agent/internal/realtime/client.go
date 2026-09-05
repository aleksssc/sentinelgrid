package realtime

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"strings"
	"time"

	"github.com/gorilla/websocket"

	"sentinelgrid/agent/internal/config"
)

const reconnectDelay = 5 * time.Second
const pingInterval = 20 * time.Second

type authMessage struct {
	Type       string `json:"type"`
	AgentToken string `json:"agent_token"`
	DeviceID   string `json:"device_id"`
	AgentID    string `json:"agent_id"`
}

type pingMessage struct {
	Type string `json:"type"`
}

type serverMessage struct {
	Type       string `json:"type"`
	DeviceID   string `json:"device_id,omitempty"`
	Hostname   string `json:"hostname,omitempty"`
	ServerTime string `json:"server_time,omitempty"`
}

func Run(
	ctx context.Context,
) {
	log.Println(
		"SentinelGrid realtime client started.",
	)

	for {
		select {
		case <-ctx.Done():
			log.Println(
				"SentinelGrid realtime client stopped.",
			)

			return

		default:
		}

		cfg, err :=
			config.Load()

		if err != nil {
			if !wait(
				ctx,
				reconnectDelay,
			) {
				return
			}

			continue
		}

		err =
			connect(
				ctx,
				cfg,
			)

		if err != nil &&
			ctx.Err() == nil {
			log.Printf(
				"Realtime disconnected: %v",
				err,
			)
		}

		if !wait(
			ctx,
			reconnectDelay,
		) {
			return
		}
	}
}

func connect(
	ctx context.Context,
	cfg *config.Config,
) error {
	if cfg == nil {
		return fmt.Errorf(
			"agent configuration is missing",
		)
	}

	socketURL, err :=
		buildWebSocketURL(
			cfg.Server,
		)

	if err != nil {
		return err
	}

	log.Printf(
		"Connecting realtime channel: %s",
		socketURL,
	)

	dialer :=
		websocket.Dialer{
			HandshakeTimeout:
				15 * time.Second,

			EnableCompression:
				true,
		}

	conn,
		_,
		err :=
		dialer.DialContext(
			ctx,
			socketURL,
			nil,
		)

	if err != nil {
		return fmt.Errorf(
			"WebSocket connection failed: %w",
			err,
		)
	}

	defer conn.Close()

	log.Println(
		"Realtime connected.",
	)

	err =
		conn.WriteJSON(
			authMessage{
				Type:
					"agent_auth",

				AgentToken:
					cfg.AgentToken,

				DeviceID:
					cfg.DeviceID,

				AgentID:
					cfg.AgentID,
			},
		)

	if err != nil {
		return fmt.Errorf(
			"could not authenticate realtime connection: %w",
			err,
		)
	}

	_,
		raw,
		err :=
		conn.ReadMessage()

	if err != nil {
		return fmt.Errorf(
			"realtime authentication failed: %w",
			err,
		)
	}

	var response serverMessage

	err =
		json.Unmarshal(
			raw,
			&response,
		)

	if err != nil {
		return fmt.Errorf(
			"invalid realtime authentication response: %w",
			err,
		)
	}

	if response.Type !=
		"authenticated" {
		return fmt.Errorf(
			"unexpected realtime authentication response: %s",
			response.Type,
		)
	}

	log.Printf(
		"Realtime authenticated. Device: %s | Hostname: %s",
		response.DeviceID,
		response.Hostname,
	)

	errChannel :=
		make(
			chan error,
			1,
		)

	go func() {
		errChannel <-
			readLoop(
				conn,
			)
	}()

	ticker :=
		time.NewTicker(
			pingInterval,
		)

	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			_ =
				conn.WriteMessage(
					websocket.CloseMessage,
					websocket.FormatCloseMessage(
						websocket.CloseNormalClosure,
						"Agent stopping",
					),
				)

			return nil

		case err :=
			<-errChannel:

			return err

		case <-ticker.C:
			err :=
				conn.WriteJSON(
					pingMessage{
						Type:
							"ping",
					},
				)

			if err != nil {
				return fmt.Errorf(
					"realtime ping failed: %w",
					err,
				)
			}
		}
	}
}

func readLoop(
	conn *websocket.Conn,
) error {
	for {
		_,
			raw,
			err :=
			conn.ReadMessage()

		if err != nil {
			return fmt.Errorf(
				"realtime read failed: %w",
				err,
			)
		}

		var message serverMessage

		err =
			json.Unmarshal(
				raw,
				&message,
			)

		if err != nil {
			log.Printf(
				"Invalid realtime message: %v",
				err,
			)

			continue
		}

		switch message.Type {
		case "pong":

		default:
			log.Printf(
				"Realtime message received: %s",
				message.Type,
			)
		}
	}
}

func buildWebSocketURL(
	server string,
) (
	string,
	error,
) {
	server =
		strings.TrimSpace(
			server,
		)

	if server == "" {
		return "",
			fmt.Errorf(
				"SentinelGrid server URL is empty",
			)
	}

	parsedURL,
		err :=
		url.Parse(
			server,
		)

	if err != nil {
		return "",
			fmt.Errorf(
				"invalid SentinelGrid server URL: %w",
				err,
			)
	}

	switch strings.ToLower(
		parsedURL.Scheme,
	) {
	case "https":
		parsedURL.Scheme =
			"wss"

	case "http":
		parsedURL.Scheme =
			"ws"

	case "wss",
		"ws":

	default:
		return "",
			fmt.Errorf(
				"unsupported SentinelGrid server scheme: %s",
				parsedURL.Scheme,
			)
	}

	parsedURL.Path =
		strings.TrimRight(
			parsedURL.Path,
			"/",
		) +
			"/api/realtime/agent"

	parsedURL.RawQuery =
		""

	parsedURL.Fragment =
		""

	return parsedURL.String(),
		nil
}

func wait(
	ctx context.Context,
	duration time.Duration,
) bool {
	timer :=
		time.NewTimer(
			duration,
		)

	defer timer.Stop()

	select {
	case <-ctx.Done():
		return false

	case <-timer.C:
		return true
	}
}