package buildinfo

import (
	_ "embed"
	"strings"
)

//go:embed VERSION
var sourceVersion string

// Override is set only by the release build's -X linker flag.
var Override string

func Version() string {
	if Override != "" {
		return Override
	}
	return strings.TrimSpace(sourceVersion)
}
