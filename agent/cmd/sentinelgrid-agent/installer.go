package main

import (
	"fmt"
	"net/url"
)

func validateInstallerServer(value string) error {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return fmt.Errorf("MSI enrollment server must be an HTTPS origin without credentials, path, query or fragment")
	}
	return nil
}
