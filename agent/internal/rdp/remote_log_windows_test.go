//go:build windows

package rdp

import (
	"strings"
	"testing"
)

func TestRemoteLogACLContract(t *testing.T) {
	const userSID = "S-1-5-21-100-200-300-400"
	directorySDDL, err := remoteLogDirectorySDDLForUser(userSID)
	if err != nil {
		t.Fatalf("build remote log directory ACL: %v", err)
	}
	fileSDDL, err := remoteLogFileSDDLForUser(userSID)
	if err != nil {
		t.Fatalf("build remote log file ACL: %v", err)
	}
	if !strings.Contains(directorySDDL, "D:P") || !strings.Contains(directorySDDL, "(A;;0x00100021;;;"+userSID+")") {
		t.Fatalf("directory ACL must be protected and grant the active user traversal only: %s", directorySDDL)
	}
	if !strings.Contains(fileSDDL, "D:P") || !strings.Contains(fileSDDL, "(A;;0x00100004;;;"+userSID+")") {
		t.Fatalf("remote log ACL must be protected and grant only the active user append plus synchronize: %s", fileSDDL)
	}
	for name, build := range map[string]func(string) (string, error){"directory": remoteLogDirectorySDDLForUser, "file": remoteLogFileSDDLForUser} {
		if _, err := build(""); err == nil {
			t.Fatalf("%s ACL accepted an empty interactive user SID", name)
		}
	}
	for _, sddl := range []string{directorySDDL, fileSDDL} {
		if strings.Contains(sddl, ";;;WD)") || strings.Contains(sddl, ";;;AU)") {
			t.Fatalf("remote log ACL grants a broad principal: %s", sddl)
		}
	}
}
