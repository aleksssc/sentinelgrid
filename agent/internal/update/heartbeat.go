package update

import (
	"log"
	"net/url"
)

func authenticatedHeartbeat(server, expectedDevice, responseDevice string, ok bool) bool {
	u, err := url.Parse(server)
	return err == nil && u.Scheme == "https" && u.Host != "" && u.User == nil &&
		ok && expectedDevice != "" && responseDevice == expectedDevice
}

func ConfirmHeartbeat(version, server, expectedDevice, responseDevice string, ok bool) {
	if !sourceQualified() {
		return
	}
	if !authenticatedHeartbeat(server, expectedDevice, responseDevice, ok) {
		log.Print("Update health confirmation rejected: unauthenticated heartbeat identity")
		return
	}
	RecordHeartbeat(version)
}
