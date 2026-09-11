package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestArtifactVerification(t *testing.T) {
	path := filepath.Join(t.TempDir(), "candidate.exe")
	data := []byte("not a signed executable")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(data)
	release := Release{Product: "SentinelGridAgent", Version: "1.0.0", Channel: "stable", Platform: "windows", Architecture: "amd64", SHA256: hex.EncodeToString(hash[:]), Size: int64(len(data))}
	called := false
	verifier := func(context.Context, string) error { called = true; return errors.New("unsigned") }
	if err := VerifyArtifact(context.Background(), path, release, verifier); err == nil || !called {
		t.Fatal("unsigned artifact accepted")
	}
	if err := VerifyArtifact(context.Background(), path, release, nil); err == nil {
		t.Fatal("missing verifier accepted")
	}
	called = false
	release.SHA256 = "0000000000000000000000000000000000000000000000000000000000000000"
	if err := VerifyArtifact(context.Background(), path, release, verifier); err == nil || called {
		t.Fatal("hash mismatch reached signature validation")
	}
	release.SHA256 = hex.EncodeToString(hash[:])
	release.Size++
	if err := VerifyArtifact(context.Background(), path, release, verifier); err == nil {
		t.Fatal("size mismatch accepted")
	}
}

func TestInsecureDownloadRejected(t *testing.T) {
	r := Release{Product: "SentinelGridAgent", Version: "1.0.0", Channel: "stable", Platform: "windows", Architecture: "amd64", SHA256: "0000000000000000000000000000000000000000000000000000000000000000", Size: 1, ExpiresAt: time.Now().Add(time.Minute)}
	for _, url := range []string{"http://example.invalid/agent.exe", "file:///agent.exe", "https://user:pass@example.invalid/agent.exe"} {
		r.DownloadURL = url
		if err := Download(context.Background(), r, filepath.Join(t.TempDir(), "candidate.exe"), nil); err == nil {
			t.Fatal("accepted insecure URL")
		}
	}
}
