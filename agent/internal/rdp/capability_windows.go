//go:build windows

package rdp

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"time"

	"golang.org/x/sys/windows/registry"
)

// Probe the fixed loopback listener, requiring CredSSP rather than just an open TCP port.
func Available(ctx context.Context) error {
	key, err := registry.OpenKey(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Control\Terminal Server`, registry.QUERY_VALUE)
	if err != nil {
		return fmt.Errorf("RDP configuration unavailable")
	}
	deny, _, err := key.GetIntegerValue("fDenyTSConnections")
	key.Close()
	if err != nil || deny != 0 {
		return fmt.Errorf("Windows RDP is disabled")
	}
	key, err = registry.OpenKey(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp`, registry.QUERY_VALUE)
	if err != nil {
		return fmt.Errorf("RDP listener configuration unavailable")
	}
	defer key.Close()
	port, _, portErr := key.GetIntegerValue("PortNumber")
	nla, _, nlaErr := key.GetIntegerValue("UserAuthentication")
	if portErr != nil || nlaErr != nil || port != 3389 || nla != 1 {
		return fmt.Errorf("RDP requires the standard listener and NLA")
	}
	return probeNLA(ctx)
}

func probeNLA(ctx context.Context) error {
	conn, err := (&net.Dialer{Timeout: 2 * time.Second}).DialContext(ctx, "tcp", "127.0.0.1:3389")
	if err != nil {
		return fmt.Errorf("RDP listener unavailable")
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(2 * time.Second))
	// TPKT + X.224 connection request + RDP_NEG_REQ (HYBRID | HYBRID_EX).
	if _, err := conn.Write([]byte{3, 0, 0, 19, 14, 0xe0, 0, 0, 0, 0, 0, 1, 0, 8, 0, 10, 0, 0, 0}); err != nil {
		return fmt.Errorf("RDP negotiation failed")
	}
	var header [4]byte
	if _, err := io.ReadFull(conn, header[:]); err != nil || header[0] != 3 || header[1] != 0 {
		return fmt.Errorf("RDP negotiation failed")
	}
	length := int(binary.BigEndian.Uint16(header[2:]))
	if length != 19 {
		return fmt.Errorf("RDP did not negotiate NLA")
	}
	var body [15]byte
	if _, err := io.ReadFull(conn, body[:]); err != nil || body[1] != 0xd0 || body[7] != 2 || binary.LittleEndian.Uint16(body[9:11]) != 8 {
		return fmt.Errorf("RDP did not negotiate NLA")
	}
	protocol := binary.LittleEndian.Uint32(body[11:15])
	if protocol != 2 && protocol != 8 {
		return fmt.Errorf("RDP did not negotiate NLA")
	}
	return nil
}
