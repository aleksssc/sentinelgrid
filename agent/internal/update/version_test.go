package update

import "testing"

func TestSemanticVersionOrdering(t *testing.T) {
	pairs := [][2]string{
		{"0.1.9", "0.1.10"}, {"1.9.9", "2.0.0"}, {"1.0.0-alpha", "1.0.0-alpha.1"},
		{"1.0.0-alpha.1", "1.0.0-alpha.beta"}, {"1.0.0-beta.2", "1.0.0-beta.11"},
		{"1.0.0-rc.1", "1.0.0"}, {"1.0.0-99999999999999999", "1.0.0-100000000000000000"},
	}
	for _, pair := range pairs {
		result, err := CompareVersions(pair[0], pair[1])
		if err != nil || result >= 0 {
			t.Fatalf("%v: %d %v", pair, result, err)
		}
		result, err = CompareVersions(pair[1], pair[0])
		if err != nil || result <= 0 {
			t.Fatalf("reverse %v: %d %v", pair, result, err)
		}
	}
}

func TestVersionEligibility(t *testing.T) {
	for _, test := range []struct {
		current, target, failed string
		want                    bool
	}{
		{"0.1.3", "0.1.3", "", false}, {"0.1.3", "0.1.2", "", false},
		{"0.1.9", "0.1.10", "", true}, {"0.1.3", "0.1.4", "0.1.4", false},
		{"0.1.3", "0.1.5", "0.1.4", true}, {"1.0.0+a", "1.0.0+b", "", false},
		{"0.1.3", "0.1.4+retry", "0.1.4", false},
	} {
		got, err := ShouldUpdate(test.current, test.target, test.failed)
		if err != nil || got != test.want {
			t.Fatalf("%+v: %v %v", test, got, err)
		}
	}
	for _, version := range []string{"", "1.2", "01.2.3", "1.2.3-01", "1.2.3-", "v1.2.3", "1.2.3\n"} {
		if _, err := CompareVersions(version, "1.0.0"); err == nil {
			t.Fatalf("accepted %q", version)
		}
	}
}

func TestChannelSelection(t *testing.T) {
	for _, channel := range []string{"dev", "beta", "stable"} {
		got, err := EffectiveChannel(channel, nil)
		if err != nil || got != channel {
			t.Fatal(channel, err)
		}
	}
	beta := "beta"
	if got, err := EffectiveChannel("stable", &beta); err != nil || got != "beta" {
		t.Fatal(got, err)
	}
	if _, err := EffectiveChannel("canary", nil); err == nil {
		t.Fatal("accepted unknown channel")
	}
}
