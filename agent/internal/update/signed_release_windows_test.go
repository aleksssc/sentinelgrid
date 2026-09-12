//go:build windows && sentinelgrid_dev_update

package update

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestWindowsSignedReleaseFailSafe(t *testing.T) {
	directory := os.Getenv("SENTINELGRID_TEST_ARTIFACT_DIRECTORY")
	if directory == "" {
		t.Skip("set SENTINELGRID_TEST_ARTIFACT_DIRECTORY to a pipeline-built signed release")
	}
	pin := os.Getenv("SENTINELGRID_TEST_SIGNER_SHA256")
	if !validSignerPins(pin, true) {
		t.Fatal("an independent SENTINELGRID_TEST_SIGNER_SHA256 is required")
	}
	data, err := os.ReadFile(filepath.Join(directory, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	type artifact struct {
		Filename string `json:"filename"`
		SHA256   string `json:"sha256"`
		Size     int64  `json:"size"`
	}
	var manifest struct {
		Version     string   `json:"version"`
		Channel     string   `json:"channel"`
		Signed      bool     `json:"signed"`
		Development bool     `json:"development_update_build"`
		Agent       artifact `json:"agent"`
		Updater     artifact `json:"updater"`
		MSI         artifact `json:"msi"`
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatal(err)
	}
	if !manifest.Signed || !manifest.Development || (manifest.Channel != "beta" && manifest.Channel != "dev") {
		t.Fatal("a signed beta/dev pipeline release is required")
	}
	old := DevelopmentSignerSHA256
	DevelopmentSignerSHA256 = pin
	defer func() { DevelopmentSignerSHA256 = old }()
	for _, item := range []struct {
		name string
		file artifact
	}{
		{"SentinelGridAgent.exe", manifest.Agent},
		{"SentinelGridUpdater.exe", manifest.Updater},
		{"SentinelGridAgent.msi", manifest.MSI},
	} {
		t.Run(item.name, func(t *testing.T) {
			if item.file.Filename != item.name {
				t.Fatal("unexpected manifest filename")
			}
			ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
			defer cancel()
			path := filepath.Join(directory, item.name)
			release := Release{Product: "SentinelGridAgent", Version: manifest.Version, Channel: manifest.Channel,
				Platform: "windows", Architecture: "amd64", SHA256: item.file.SHA256, Size: item.file.Size}
			if err := VerifyArtifact(ctx, path, release, VerifySignature); err != nil {
				t.Fatalf("valid signed pipeline artifact rejected: %v", err)
			}
			bad := release
			bad.SHA256 = strings.Repeat("0", 64)
			if err := VerifyArtifact(ctx, path, bad, VerifySignature); err == nil || !strings.Contains(err.Error(), "SHA256 mismatch") {
				t.Fatalf("incorrect SHA256 did not fail closed: %v", err)
			}
			bad = release
			bad.Size++
			if err := VerifyArtifact(ctx, path, bad, VerifySignature); err == nil || !strings.Contains(err.Error(), "size/type mismatch") {
				t.Fatalf("incorrect size did not fail closed: %v", err)
			}
			DevelopmentSignerSHA256 = strings.Repeat("0", 64)
			err := VerifyArtifact(ctx, path, release, VerifySignature)
			DevelopmentSignerSHA256 = pin
			if err == nil || !strings.Contains(err.Error(), "unexpected Authenticode signer") {
				t.Fatalf("incorrect signer pin did not fail closed: %v", err)
			}
		})
	}
}
