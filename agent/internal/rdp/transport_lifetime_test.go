package rdp

import (
	"errors"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type pairingDeadlineProbe struct {
	deadlines []time.Time
	closed    bool
	failClear bool
	kind      int
	payload   []byte
}

func (p *pairingDeadlineProbe) SetReadLimit(int64) {}
func (p *pairingDeadlineProbe) SetReadDeadline(deadline time.Time) error {
	p.deadlines = append(p.deadlines, deadline)
	if deadline.IsZero() && p.failClear {
		return errors.New("deadline update failed")
	}
	return nil
}
func (p *pairingDeadlineProbe) ReadMessage() (int, []byte, error) { return p.kind, p.payload, nil }
func (p *pairingDeadlineProbe) Close() error                      { p.closed = true; return nil }

func TestPairedSessionDoesNotInheritLaunchExpiry(t *testing.T) {
	p := &pairingDeadlineProbe{kind: websocket.TextMessage, payload: []byte(`{"type":"ready"}`)}
	started := time.Now()
	if err := awaitRelayReady(p); err != nil {
		t.Fatal(err)
	}
	if len(p.deadlines) != 2 || p.deadlines[0].Before(started.Add(65*time.Second)) || p.deadlines[0].After(time.Now().Add(65*time.Second)) {
		t.Fatalf("pairing must retain its bounded 65s deadline: %v", p.deadlines)
	}
	if !p.deadlines[1].IsZero() {
		t.Fatalf("active socket inherited an establishment deadline: %v", p.deadlines[1])
	}
	for _, elapsed := range []time.Duration{time.Minute, 2 * time.Minute, 120 * time.Minute} {
		deadline := p.deadlines[len(p.deadlines)-1]
		if !deadline.IsZero() && !started.Add(elapsed).Before(deadline) {
			t.Fatalf("healthy session expires after %s", elapsed)
		}
	}
	if p.closed {
		t.Fatal("healthy paired socket was closed")
	}
}

func TestPairingDeadlineClearFailureClosesSocket(t *testing.T) {
	p := &pairingDeadlineProbe{kind: websocket.TextMessage, payload: []byte(`{"type":"ready"}`), failClear: true}
	if err := awaitRelayReady(p); err == nil || pairingCategory(err) != "ready_deadline" || !p.closed {
		t.Fatalf("deadline failure must fail closed: %v, closed=%t", err, p.closed)
	}
}

func TestPairingRejectsInvalidReadyWithoutOpeningSession(t *testing.T) {
	p := &pairingDeadlineProbe{kind: websocket.BinaryMessage, payload: []byte(`{"type":"ready"}`)}
	if err := awaitRelayReady(p); err == nil || !p.closed || len(p.deadlines) != 1 {
		t.Fatalf("invalid ready accepted: %v", err)
	}
}
