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
	fileSDDL, err := remoteLogFileSDDLForUser("S-1-5-21-100-200-300-400")
	if err != nil {
		t.Fatalf("build remote log ACL: %v", err)
	}
	if !strings.Contains(fileSDDL, "D:P") || !strings.Contains(fileSDDL, "(A;;0x00100004;;;S-1-5-21-100-200-300-400)") {
		t.Fatalf("remote log ACL must be protected and grant only the active user append plus synchronize: %s", fileSDDL)
	}
	if _, err := remoteLogFileSDDLForUser(""); err == nil {
		t.Fatal("empty interactive user SID produced a log ACL")
	}
	for _, sddl := range []string{remoteLogRootSDDL, remoteLogDirectorySDDL, fileSDDL} {
		if strings.Contains(sddl, ";;;WD)") || strings.Contains(sddl, ";;;AU)(A;;FA") || strings.Contains(sddl, "(A;;0x00100004;;;AU)") {
			t.Fatalf("remote log ACL grants an unsafe principal: %s", sddl)
		}
	}
}
