package main

import "testing"

func TestInstallerServerRequiresHTTPSOrigin(t *testing.T) {
	for _, value := range []string{"https://sentinelgrid.example", "https://test.example:8443/"} {
		if err := validateInstallerServer(value); err != nil {
			t.Fatal(err)
		}
	}
	for _, value := range []string{"", "http://test.example", "https://user:pass@test.example", "https://test.example/path", "https://test.example?token=x", "https://test.example?", "https://test.example#x"} {
		if validateInstallerServer(value) == nil {
			t.Fatalf("accepted %q", value)
		}
	}
}

func TestInstallerFilenameEnrollmentContract(t *testing.T) {
	token, err := enrollmentTokenFromInstallerPath(`C:\Downloads\SentinelGridAgent__SG-ENROLL-test.msi`)
	if err != nil || token != "SG-ENROLL-test" {
		t.Fatalf("existing filename contract failed: %v", err)
	}
	for _, value := range []string{"", `C:\Downloads\Agent.msi`, `C:\Downloads\SentinelGridAgent__not-a-token.msi`, `C:\Downloads\SentinelGridAgent__SG-ENROLL-test.exe`} {
		if _, err := enrollmentTokenFromInstallerPath(value); err == nil {
			t.Fatalf("accepted %q", value)
		}
	}
}
