//go:build windows

package main

import (
	"context"
	"fmt"
	"time"

	"github.com/gorilla/websocket"
	"sentinelgrid/agent/internal/rdp"
)

// runURI opens the responsive viewer before redeeming the one-use URI token, so
// users see connection progress rather than an unpainted native window.
func runURI(rawURI string) error {
	token, err := rdp.ParseLaunchURI(rawURI)
	if err != nil {
		return fmt.Errorf("invalid SentinelGrid Remote link")
	}
	return runViewerConnecting(func(ctx context.Context) (*websocket.Conn, error) {
		redeemCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		defer cancel()
		connection, err := rdp.RedeemLaunch(redeemCtx, rdp.DefaultRemoteServer, token)
		if err != nil {
			return nil, err
		}
		return rdp.Dial(redeemCtx, connection)
	})
}
