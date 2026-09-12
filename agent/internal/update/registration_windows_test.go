//go:build windows

package update

import (
	"context"
	"testing"
	"time"
)

func TestInstalledServiceACLRestrictsLifecycleControl(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_, err := systemPowerShell(ctx, `
$sd = New-Object Security.AccessControl.RawSecurityDescriptor($env:SG_TEST_SERVICE_SDDL)
$privileged = @()
foreach ($ace in $sd.DiscretionaryAcl) {
 if ($ace.AceQualifier -ne [Security.AccessControl.AceQualifier]::AccessAllowed) { throw 'Unexpected service ACE' }
 $sid = $ace.SecurityIdentifier.Value
 if ($sid -in @('S-1-5-18','S-1-5-32-544')) {
  if (($ace.AccessMask -band 0x000f01ff) -ne 0x000f01ff) { throw 'Administrator or SYSTEM lost service control' }
  $privileged += $sid
 } else {
  if (($ace.AccessMask -band 0x000d0132) -ne 0) { throw 'Unsafe service ACL' }
  if (($ace.AccessMask -band 0x0002008d) -ne 0x0002008d) { throw 'Read-only service inspection unavailable' }
 }
}
if ($privileged.Count -ne 2) { throw 'Missing privileged service principal' }
`, "SG_TEST_SERVICE_SDDL="+serviceSecurity)
	if err != nil {
		t.Fatal(err)
	}
}
