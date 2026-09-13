package rdp

import "testing"

func TestParseLaunchURI(t *testing.T) {
	valid := "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	if got, err := ParseLaunchURI("sentinelgrid://remote/" + valid); err != nil || got != valid {
		t.Fatal("valid launch URI was rejected")
	}
	for _, raw := range []string{"http://remote/" + valid, "sentinelgrid://remote/" + valid + "?x=1", "sentinelgrid://remote/a/b", "sentinelgrid://user@remote/" + valid, "sentinelgrid://remote/short"} {
		if _, err := ParseLaunchURI(raw); err == nil {
			t.Fatalf("invalid launch URI accepted: %s", raw)
		}
	}
}
