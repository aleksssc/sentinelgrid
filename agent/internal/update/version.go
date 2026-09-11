package update

import (
	"fmt"
	"regexp"
	"strings"
)

var versionPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$`)
var numericPattern = regexp.MustCompile(`^[0-9]+$`)

func parseVersion(value string) ([]string, error) {
	if len(value) > 128 {
		return nil, fmt.Errorf("invalid semantic version")
	}
	parts := versionPattern.FindStringSubmatch(value)
	if parts == nil {
		return nil, fmt.Errorf("invalid semantic version")
	}
	for _, id := range strings.Split(parts[4], ".") {
		if numericPattern.MatchString(id) && len(id) > 1 && id[0] == '0' {
			return nil, fmt.Errorf("invalid numeric prerelease identifier")
		}
	}
	return parts, nil
}

func compareNumber(a, b string) int {
	if len(a) < len(b) {
		return -1
	}
	if len(a) > len(b) {
		return 1
	}
	return strings.Compare(a, b)
}

func CompareVersions(a, b string) (int, error) {
	x, err := parseVersion(a)
	if err != nil {
		return 0, err
	}
	y, err := parseVersion(b)
	if err != nil {
		return 0, err
	}
	for i := 1; i <= 3; i++ {
		if c := compareNumber(x[i], y[i]); c != 0 {
			return c, nil
		}
	}
	if x[4] == y[4] {
		return 0, nil
	}
	if x[4] == "" {
		return 1, nil
	}
	if y[4] == "" {
		return -1, nil
	}
	xp, yp := strings.Split(x[4], "."), strings.Split(y[4], ".")
	for i := 0; i < len(xp) && i < len(yp); i++ {
		xn, yn := numericPattern.MatchString(xp[i]), numericPattern.MatchString(yp[i])
		c := strings.Compare(xp[i], yp[i])
		if xn && yn {
			c = compareNumber(xp[i], yp[i])
		} else if xn != yn {
			c = 1
			if xn {
				c = -1
			}
		}
		if c != 0 {
			return c, nil
		}
	}
	if len(xp) < len(yp) {
		return -1, nil
	}
	return 1, nil
}

func ShouldUpdate(current, target, failed string) (bool, error) {
	c, err := CompareVersions(target, current)
	if err != nil || c <= 0 {
		return false, err
	}
	if failed != "" {
		c, err = CompareVersions(target, failed)
		if err != nil || c == 0 {
			return false, err
		}
	}
	return true, nil
}

func EffectiveChannel(organization string, override *string) (string, error) {
	channel := organization
	if override != nil {
		channel = *override
	}
	switch channel {
	case "stable", "beta", "dev":
		return channel, nil
	default:
		return "", fmt.Errorf("invalid update channel")
	}
}
