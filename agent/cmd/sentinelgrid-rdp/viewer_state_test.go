package main

import (
	"testing"

	"github.com/gorilla/websocket"
)

func TestInputIsDisabledAfterRelayClose(t *testing.T) {
	viewer := &viewer{ws: &websocket.Conn{}}
	if !viewer.inputEnabled() {
		t.Fatal("connected viewer rejected input")
	}
	viewer.sessionClosed = true
	if viewer.inputEnabled() {
		t.Fatal("closed viewer accepted input")
	}
}
