//go:build windows

package update

import (
	"context"
	"path/filepath"
)

func (h *WindowsHost) CurrentVersion(ctx context.Context) (string, error) {
	path := filepath.Join(h.InstallDir, "SentinelGridAgent.exe")
	file, err := pinFile(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	return signedVersion(ctx, path, "Agent")
}
