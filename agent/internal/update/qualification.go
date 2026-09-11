package update

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Production qualification stays independent of development builds.
// Both pins are linker inputs, never runtime environment or API configuration.
var TrustedSignerSHA256 string
var DevelopmentSignerSHA256 string

func validSignerPins(value string, single bool) bool {
	pins := strings.Split(value, ",")
	if single && len(pins) != 1 {
		return false
	}
	for _, pin := range pins {
		if len(pin) != 64 || strings.IndexFunc(pin, func(r rune) bool { return !strings.ContainsRune("0123456789abcdefABCDEF", r) }) >= 0 {
			return false
		}
	}
	return true
}

func sourceQualified() bool {
	if developmentBuild {
		return validSignerPins(DevelopmentSignerSHA256, true) && TrustedSignerSHA256 == ""
	}
	return Qualified
}

func signerPins() string {
	if developmentBuild {
		return DevelopmentSignerSHA256
	}
	return TrustedSignerSHA256
}

type BuildTrust struct {
	Development    bool   `json:"development"`
	SourceEligible bool   `json:"source_eligible"`
	SignerSHA256   string `json:"signer_sha256"`
}

func buildTrust() BuildTrust {
	return BuildTrust{developmentBuild, sourceQualified(), strings.ToUpper(signerPins())}
}

func BuildTrustJSON() string {
	data, err := json.Marshal(buildTrust())
	if err != nil {
		panic(fmt.Sprintf("encode build trust: %v", err))
	}
	return string(data)
}
