//go:build windows

package main

import (
	"context"
	"log"
	"os"
	"time"

	"sentinelgrid/agent/internal/rdp"
)

func init() {
	if len(os.Args) != 3 || os.Args[1] != "-uri" {
		return
	}
	token, err := rdp.ParseLaunchURI(os.Args[2])
	if err == nil {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		var connection rdp.Connection
		connection, err = rdp.RedeemLaunch(ctx, rdp.DefaultRemoteServer, token)
		if err == nil {
			ws, dialErr := rdp.Dial(ctx, connection)
			if dialErr != nil {
				err = dialErr
			} else {
				defer ws.Close()
				err = runViewer(ws)
			}
		}
	}
	if err != nil {
		log.Print("SentinelGrid Remote could not start: ", err)
	}
	os.Exit(boolExitCode(err != nil))
}

func boolExitCode(failed bool) int {
	if failed {
		return 1
	}
	return 0
}
