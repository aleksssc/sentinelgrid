//go:build !windows

package rdp

func EnsureProtocolRegistration() error { return nil }
