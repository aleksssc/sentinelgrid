package inventory

import (
	"net"
	"os"
	"runtime"
)

type Inventory struct {
	Hostname   string `json:"hostname"`
	OS         string `json:"os"`
	Arch       string `json:"arch"`
	LocalIP    string `json:"local_ip"`
	MACAddress string `json:"mac_address"`
}

func Collect() (*Inventory, error) {
	hostname, err := os.Hostname()

	if err != nil {
		return nil, err
	}

	localIP, macAddress := getPrimaryNetwork()

	return &Inventory{
		Hostname:   hostname,
		OS:         runtime.GOOS,
		Arch:       runtime.GOARCH,
		LocalIP:    localIP,
		MACAddress: macAddress,
	}, nil
}

func getPrimaryNetwork() (string, string) {
	interfaces, err := net.Interfaces()

	if err != nil {
		return "", ""
	}

	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 {
			continue
		}

		if iface.Flags&net.FlagLoopback != 0 {
			continue
		}

		addresses, err := iface.Addrs()

		if err != nil {
			continue
		}

		for _, address := range addresses {
			var ip net.IP

			switch value := address.(type) {
			case *net.IPNet:
				ip = value.IP

			case *net.IPAddr:
				ip = value.IP
			}

			if ip == nil {
				continue
			}

			ip = ip.To4()

			if ip == nil {
				continue
			}

			return ip.String(), iface.HardwareAddr.String()
		}
	}

	return "", ""
}