//go:build windows

package update

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestWindowsProtectedPathUsesSIDsWithoutAccountLookup(t *testing.T) {
	const unknownSID = "S-1-5-21-424242-424242-424242-12345"
	for _, tc := range []struct {
		name     string
		sddl     string
		ancestor bool
		want     string
	}{
		{"unmapped read-only principal", "O:SYG:SYD:P(A;;FA;;;SY)(A;;FR;;;" + unknownSID + ")", false, ""},
		{"unmapped writable principal", "O:SYG:SYD:P(A;;FA;;;SY)(A;;FW;;;" + unknownSID + ")", false, "Writable path"},
		{"unmapped owner", "O:" + unknownSID + "G:SYD:P(A;;FA;;;SY)", false, "Untrusted owner"},
		{"administrator write", "O:BAG:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)", false, ""},
		{"inherited unmapped write", "O:SYG:SYD:P(A;;FA;;;SY)(A;ID;FW;;;" + unknownSID + ")", false, "Writable path"},
		{"unmapped ancestor delete-child", "O:SYG:SYD:P(A;;FA;;;SY)(A;;0x40;;;" + unknownSID + ")", true, "Writable path"},
		{"ancestor create-child only", "O:SYG:SYD:P(A;;FA;;;SY)(A;;0x4;;;" + unknownSID + ")", true, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			script := protectedPathValidation + `
$script:acl = New-Object Security.AccessControl.DirectorySecurity
$script:acl.SetSecurityDescriptorSddlForm($env:SG_TEST_SDDL)
function Get-Item { [pscustomobject]@{ Attributes = [IO.FileAttributes]::Directory } }
function Get-Acl { $script:acl }
Assert-Protected 'test-only-in-memory-acl' ($env:SG_TEST_ANCESTOR -eq 'true')
`
			ancestor := "false"
			if tc.ancestor {
				ancestor = "true"
			}
			_, err := systemPowerShell(ctx, script, "SG_TEST_SDDL="+tc.sddl, "SG_TEST_ANCESTOR="+ancestor)
			if tc.want == "" {
				if err != nil {
					t.Fatal(err)
				}
			} else if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("expected %q, got %v", tc.want, err)
			}
		})
	}
}
