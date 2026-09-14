//go:build windows

package rdp

import (
	"strings"
	"testing"
)

func TestRemoteLogACLContract(t *testing.T) {
	for name, sddl := range map[string]string{
		"root": remoteLogRootSDDL,
		"logs": remoteLogDirectorySDDL,
	} {
		if !strings.Contains(sddl, "D:P") || !strings.Contains(sddl, "(A;;0x00100020;;;AU)") {
			t.Fatalf("%s ACL must be protected and grant Authenticated Users traversal only: %s", name, sddl)
		}
	}
	if !strings.Contains(remoteLogFileSDDL, "D:P") || !strings.Contains(remoteLogFileSDDL, "(A;;0x00100004;;;AU)") {
		t.Fatalf("remote log ACL must be protected and grant Authenticated Users append plus synchronize only: %s", remoteLogFileSDDL)
	}
	for _, sddl := range []string{remoteLogRootSDDL, remoteLogDirectorySDDL, remoteLogFileSDDL} {
		if strings.Contains(sddl, ";;;WD)") || strings.Contains(sddl, ";;;AU)(A;;FA") {
			t.Fatalf("remote log ACL grants an unsafe principal: %s", sddl)
		}
	}
}
