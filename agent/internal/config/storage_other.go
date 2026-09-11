//go:build !windows

package config

import "os"

func prepareDirectory(dir string) error         { return os.MkdirAll(dir, 0700) }
func replaceConfig(source, target string) error { return os.Rename(source, target) }
