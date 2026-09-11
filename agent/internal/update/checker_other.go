//go:build !windows

package update

import (
	"context"
	"fmt"
)

func Run(_ context.Context, _ string) {}
func RecordHeartbeat(_ string)        {}
func operational(context.Context) error {
	return fmt.Errorf("Windows updates are unsupported on this platform")
}
func ReadinessDiagnostic() error { return operational(context.Background()) }
func RequestUpdate(context.Context, string) error {
	return fmt.Errorf("secure updater is not operational")
}
func GuardPowerAction(context.Context) (func() error, error) { return func() error { return nil }, nil }
