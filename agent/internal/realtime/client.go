package realtime

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/url"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"sentinelgrid/agent/internal/config"
)

/* =========================================
   CONSTANTS
========================================= */

const (
	reconnectDelay = 5 * time.Second
	pingInterval   = 20 * time.Second

	commandTimeout = 5 * time.Minute

	maxCommandOutput = 256 * 1024
)

/* =========================================
   AUTH MESSAGE
========================================= */

type authMessage struct {
	Type string `json:"type"`

	AgentToken string `json:"agent_token"`

	DeviceID string `json:"device_id"`

	AgentID string `json:"agent_id"`
}

/* =========================================
   PING
========================================= */

type pingMessage struct {
	Type string `json:"type"`
}

/* =========================================
   SERVER MESSAGE
========================================= */

type serverMessage struct {
	Type string `json:"type"`

	DeviceID string `json:"device_id,omitempty"`

	Hostname string `json:"hostname,omitempty"`

	ServerTime string `json:"server_time,omitempty"`

	CommandID string `json:"command_id,omitempty"`

	SessionID string `json:"session_id,omitempty"`

	Shell string `json:"shell,omitempty"`

	Command string `json:"command,omitempty"`

	CommandType string `json:"command_type,omitempty"`

	Payload map[string]any `json:"payload,omitempty"`

	IdempotencyKey string `json:"idempotency_key,omitempty"`

	CreatedAt string `json:"created_at,omitempty"`

	ExpiresAt string `json:"expires_at,omitempty"`
}

/* =========================================
   COMMAND RESULT
========================================= */

type commandResultMessage struct {
	Type string `json:"type"`

	CommandID string `json:"command_id"`

	SessionID string `json:"session_id"`

	Stdout string `json:"stdout"`

	Stderr string `json:"stderr"`

	ExitCode int `json:"exit_code"`
}

/* =========================================
   LIMITED BUFFER
========================================= */

type limitedBuffer struct {
	buffer bytes.Buffer

	limit int

	truncated bool
}

func (b *limitedBuffer) Write(
	data []byte,
) (
	int,
	error,
) {
	originalLength :=
		len(data)

	remaining :=
		b.limit -
			b.buffer.Len()

	if remaining <= 0 {
		b.truncated =
			true

		return originalLength,
			nil
	}

	if len(data) >
		remaining {
		_,
			_ =
			b.buffer.Write(
				data[:remaining],
			)

		b.truncated =
			true

		return originalLength,
			nil
	}

	_,
		_ =
		b.buffer.Write(
			data,
		)

	return originalLength,
		nil
}

func (b *limitedBuffer) String() string {
	value :=
		b.buffer.String()

	if b.truncated {
		value +=
			"\r\n[SentinelGrid: output truncated]"
	}

	return value
}

/* =========================================
   RUN
========================================= */

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

		cfg,
			err :=
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

/* =========================================
   CONNECT
========================================= */

func connect(
	ctx context.Context,
	cfg *config.Config,
) error {
	if cfg == nil {
		return fmt.Errorf(
			"Agent configuration is missing",
		)
	}

	socketURL,
		err :=
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
			HandshakeTimeout: 15 *
				time.Second,

			EnableCompression: true,
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

	/*
		Gorilla WebSocket only permits
		one concurrent writer.
	*/

	var writeMu sync.Mutex

	/* =====================================
	   AUTH
	===================================== */

	writeMu.Lock()

	err =
		conn.WriteJSON(
			authMessage{
				Type: "agent_auth",

				AgentToken: cfg.AgentToken,

				DeviceID: cfg.DeviceID,

				AgentID: cfg.AgentID,
			},
		)

	writeMu.Unlock()

	if err != nil {
		return fmt.Errorf(
			"could not authenticate realtime connection: %w",
			err,
		)
	}

	/* =====================================
	   AUTH RESPONSE
	===================================== */

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

	/* =====================================
	   CONNECTION
	===================================== */

	errChannel :=
		make(
			chan error,
			1,
		)

	go func() {
		errChannel <- readLoop(
			ctx,
			conn,
			&writeMu,
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
			writeMu.Lock()

			_ =
				conn.WriteMessage(
					websocket.CloseMessage,
					websocket.FormatCloseMessage(
						websocket.CloseNormalClosure,
						"Agent stopping",
					),
				)

			writeMu.Unlock()

			return nil

		case err :=
			<-errChannel:

			return err

		case <-ticker.C:
			writeMu.Lock()

			err :=
				conn.WriteJSON(
					pingMessage{
						Type: "ping",
					},
				)

			writeMu.Unlock()

			if err != nil {
				return fmt.Errorf(
					"realtime ping failed: %w",
					err,
				)
			}
		}
	}
}

/* =========================================
   READ LOOP
========================================= */

func readLoop(
	ctx context.Context,
	conn *websocket.Conn,
	writeMu *sync.Mutex,
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

		/* =================================
		   PONG
		================================= */

		case "pong":
			// Connection alive.

		/* =================================
		   COMMAND
		================================= */

		case "command":
			if message.CommandID == "" ||
				message.SessionID == "" {
				log.Println(
					"Realtime command rejected: missing command/session ID.",
				)

				continue
			}

			/*
				Execute outside the reader loop so
				pings and new messages continue.
			*/

			go handleCommand(
				ctx,
				conn,
				writeMu,
				message,
			)

		case "typed_command":
			if message.CommandID == "" ||
				message.CommandType == "" ||
				message.IdempotencyKey == "" ||
				message.ExpiresAt == "" {
				log.Println("Typed command rejected: missing required fields.")
				continue
			}

			go handleTypedCommand(
				ctx,
				conn,
				writeMu,
				message,
			)

		/* =================================
		   OTHER
		================================= */

		default:
			log.Printf(
				"Realtime message received: %s",
				message.Type,
			)
		}
	}
}

/* =========================================
   HANDLE COMMAND
========================================= */

func handleCommand(
	parentContext context.Context,
	conn *websocket.Conn,
	writeMu *sync.Mutex,
	message serverMessage,
) {
	log.Printf(
		"Remote command received. ID: %s | Shell: %s",
		message.CommandID,
		message.Shell,
	)

	stdout,
		stderr,
		exitCode :=
		executeCommand(
			parentContext,
			message.Shell,
			message.Command,
		)

	result :=
		commandResultMessage{
			Type: "command_result",

			CommandID: message.CommandID,

			SessionID: message.SessionID,

			Stdout: stdout,

			Stderr: stderr,

			ExitCode: exitCode,
		}

	writeMu.Lock()

	err :=
		conn.WriteJSON(
			result,
		)

	writeMu.Unlock()

	if err != nil {
		log.Printf(
			"Could not send command result. ID: %s | Error: %v",
			message.CommandID,
			err,
		)

		return
	}

	log.Printf(
		"Remote command completed. ID: %s | Exit code: %d",
		message.CommandID,
		exitCode,
	)
}

/* =========================================
   EXECUTE COMMAND
========================================= */

func executeCommand(
	parentContext context.Context,
	shell string,
	command string,
) (
	string,
	string,
	int,
) {
	shell =
		strings.ToLower(
			strings.TrimSpace(
				shell,
			),
		)

	command =
		strings.TrimSpace(
			command,
		)

	if command == "" {
		return "",
			"Command is empty.",
			126
	}

	commandContext,
		cancel :=
		context.WithTimeout(
			parentContext,
			commandTimeout,
		)

	defer cancel()

	var cmd *exec.Cmd

	switch shell {

	/* =====================================
	   CMD
	===================================== */

	case "cmd":
		cmd =
			exec.CommandContext(
				commandContext,
				"cmd.exe",
				"/D",
				"/S",
				"/C",
				command,
			)

	/* =====================================
	   POWERSHELL
	===================================== */

	case "powershell":
		cmd =
			exec.CommandContext(
				commandContext,
				"powershell.exe",
				"-NoLogo",
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				command,
			)

	default:
		return "",
			"Unsupported shell. Use cmd or powershell.",
			126
	}

	/* =====================================
	   OUTPUT
	===================================== */

	stdoutBuffer :=
		&limitedBuffer{
			limit: maxCommandOutput,
		}

	stderrBuffer :=
		&limitedBuffer{
			limit: maxCommandOutput,
		}

	cmd.Stdout =
		stdoutBuffer

	cmd.Stderr =
		stderrBuffer

	/* =====================================
	   EXECUTE
	===================================== */

	err :=
		cmd.Run()

	stdout :=
		strings.TrimRight(
			stdoutBuffer.String(),
			"\r\n",
		)

	stderr :=
		strings.TrimRight(
			stderrBuffer.String(),
			"\r\n",
		)

	if errors.Is(
		commandContext.Err(),
		context.DeadlineExceeded,
	) {
		if stderr != "" {
			stderr +=
				"\r\n"
		}

		stderr +=
			"SentinelGrid: command timed out after 5 minutes."

		return stdout,
			stderr,
			124
	}

	if err == nil {
		return stdout,
			stderr,
			0
	}

	var exitError *exec.ExitError

	if errors.As(
		err,
		&exitError,
	) {
		return stdout,
			stderr,
			exitError.ExitCode()
	}

	if stderr != "" {
		stderr +=
			"\r\n"
	}

	stderr +=
		err.Error()

	return stdout,
		stderr,
		1
}

/* =========================================
   WEBSOCKET URL
========================================= */

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

/* =========================================
   WAIT
========================================= */

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
