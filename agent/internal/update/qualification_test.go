package update

import (
	"strings"
	"testing"
)

func TestSignerPinValidation(t *testing.T) {
	for _, input := range []string{"", "*", strings.Repeat("g", 64), strings.Repeat("a", 63), strings.Repeat("a", 64) + ",", " " + strings.Repeat("a", 64)} {
		if validSignerPins(input, false) {
			t.Fatalf("accepted invalid pin %q", input)
		}
	}
	pin := strings.Repeat("a", 64)
	if !validSignerPins(pin, true) || !validSignerPins(pin+","+pin, false) || validSignerPins(pin+","+pin, true) {
		t.Fatal("pin cardinality failure")
	}
}

func TestDevelopmentQualificationIsolation(t *testing.T) {
	oldProd, oldDev := TrustedSignerSHA256, DevelopmentSignerSHA256
	defer func() { TrustedSignerSHA256, DevelopmentSignerSHA256 = oldProd, oldDev }()
	TrustedSignerSHA256, DevelopmentSignerSHA256 = "", ""
	if sourceQualified() {
		t.Fatal("compilation alone enabled qualification")
	}
	DevelopmentSignerSHA256 = strings.Repeat("A", 64)
	if sourceQualified() != developmentBuild {
		t.Fatal("development pin bypassed build boundary")
	}
	if !developmentBuild && signerPins() != "" {
		t.Fatal("production consumed development pin")
	}
	TrustedSignerSHA256 = strings.Repeat("B", 64)
	if sourceQualified() {
		t.Fatal("mixed trust enabled qualification")
	}
	if !developmentBuild && signerPins() != TrustedSignerSHA256 {
		t.Fatal("production signer changed")
	}
}
