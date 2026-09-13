//go:build windows

package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/sys/windows"
	buildinfo "sentinelgrid/agent"
	"sentinelgrid/agent/internal/rdp"
)

func run(path string) error {
	if !strings.EqualFold(filepath.Ext(path), ".sgrdp") {
		return fmt.Errorf("select a SentinelGrid .sgrdp connection file")
	}
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("connection file could not be opened")
	}
	data, readErr := io.ReadAll(io.LimitReader(file, 2049))
	file.Close()
	if readErr != nil || len(data) > 2048 {
		return fmt.Errorf("invalid connection file")
	}
	var connection rdp.Connection
	if json.Unmarshal(data, &connection) != nil || connection.Version != 1 || connection.Validate() != nil || connection.ExpiresAt.After(time.Now().Add(61*time.Second)) {
		return fmt.Errorf("invalid or expired connection file; request a new session in Device View")
	}
	if err := os.Remove(path); err != nil {
		return fmt.Errorf("could not remove consumed one-time connection file")
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	// The relay enforces the full session expiry; the file deadline only limits ticket redemption.
	ws, err := rdp.Dial(ctx, connection)
	if err != nil {
		return err
	}
	defer ws.Close()
	ws.SetReadDeadline(time.Time{})
	listener, err := net.ListenTCP("tcp4", &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		return fmt.Errorf("could not create loopback RDP listener")
	}
	defer listener.Close()
	stop := context.AfterFunc(ctx, func() { listener.Close() })
	defer stop()
	listener.SetDeadline(time.Now().Add(time.Minute))
	native, err := os.CreateTemp("", "SentinelGrid-*.rdp")
	if err != nil {
		return err
	}
	defer os.Remove(native.Name())
	settings := fmt.Sprintf("full address:s:%s\r\nprompt for credentials:i:1\r\nenablecredsspsupport:i:1\r\nauthentication level:i:2\r\nredirectclipboard:i:0\r\nredirectprinters:i:0\r\nredirectcomports:i:0\r\nredirectsmartcards:i:0\r\ndrivestoredirect:s:\r\ndevicestoredirect:s:\r\naudiocapturemode:i:0\r\n", listener.Addr())
	_, writeErr := native.WriteString(settings)
	closeErr := native.Close()
	if writeErr != nil || closeErr != nil {
		return fmt.Errorf("could not create native RDP settings")
	}
	root, err := windows.GetWindowsDirectory()
	if err != nil {
		return err
	}
	cmd := exec.Command(filepath.Join(root, "System32", "mstsc.exe"), native.Name())
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("Windows Remote Desktop client could not start")
	}
	go func() {
		if err := cmd.Wait(); err != nil {
			log.Print("Windows Remote Desktop client exited with an error")
		}
	}()
	fmt.Println("RDP tunnel ready. Enter Windows credentials only in Remote Desktop. Verify the endpoint certificate; close the session in Device View or press Ctrl+C to disconnect.")
	tcp, err := listener.AcceptTCP()
	if err != nil {
		return fmt.Errorf("native RDP client did not connect")
	}
	listener.Close()
	return rdp.Bridge(ctx, ws, tcp)
}

func main() {
	version := flag.Bool("version", false, "Show RDP product version")
	channel := flag.Bool("release-channel", false, "Show embedded release channel")
	path := flag.String("connection", "", "One-time .sgrdp file downloaded from Device View (consumed and removed)")
	flag.Parse()
	if *version || *channel {
		if *path != "" || flag.NArg() != 0 || (*version && *channel) {
			log.Fatal("Conflicting RDP diagnostic modes")
		}
		if *version {
			fmt.Printf("SentinelGrid RDP %s\n", buildinfo.Version())
		} else {
			fmt.Println(buildinfo.Channel)
		}
		return
	}
	if flag.NArg() != 0 || *path == "" {
		log.Fatal("Usage: SentinelGridRDP.exe -connection <download.sgrdp>")
	}
	if err := run(*path); err != nil {
		log.Fatal(err)
	}
}
