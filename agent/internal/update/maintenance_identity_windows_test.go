//go:build windows

package update

import (
	"context"
	"strings"
	"testing"

	"golang.org/x/sys/windows"
)

func TestMaintenanceRequiresSystemEvenWhenProductionUpdatesAreDisabled(t *testing.T) {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		t.Fatal(err)
	}
	if user.User.Sid.String() == "S-1-5-18" {
		t.Skip("identity rejection test requires a non-SYSTEM runner")
	}
	for _, begin := range []bool{true, false} {
		err := Maintenance(context.Background(), begin)
		if err == nil || !strings.Contains(err.Error(), "requires LocalSystem") {
			t.Fatalf("maintenance identity was bypassed: %v", err)
		}
	}
}
