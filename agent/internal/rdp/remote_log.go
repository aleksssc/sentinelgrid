package rdp

import (
	"regexp"
	"strings"
)

const (
	remoteLogAppendAccess = 0x00100004 // SYNCHRONIZE | FILE_APPEND_DATA
	remoteLogShareMode    = 0x00000003 // FILE_SHARE_READ | FILE_SHARE_WRITE
	remoteLogDisposition  = 3          // OPEN_EXISTING
)

var remoteLogURL = regexp.MustCompile(`(?i)\b(?:https?|wss?)://[^\s]+`)
var remoteLogCredential = regexp.MustCompile(`(?i)\b(ticket|launch[_-]?token|agent[_-]?token|token|cookie|authorization|credential|password)\s*=\s*[^\s,;]+`)
var remoteLogBearer = regexp.MustCompile(`(?i)\bbearer\s+[^\s,;]+`)

// sanitizeRemoteLogError keeps diagnostic causes while excluding values that
// could authenticate a relay or API request.
func sanitizeRemoteLogError(err error) string {
	if err == nil {
		return "none"
	}
	message := strings.Join(strings.Fields(err.Error()), " ")
	message = remoteLogURL.ReplaceAllString(message, "[url]")
	message = remoteLogCredential.ReplaceAllString(message, "$1=[redacted]")
	message = remoteLogBearer.ReplaceAllString(message, "******")
	if len(message) > 240 {
		message = message[:240]
	}
	if message == "" {
		return "unknown"
	}
	return message
}
