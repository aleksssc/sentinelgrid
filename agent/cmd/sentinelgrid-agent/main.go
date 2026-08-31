package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"

	"sentinelgrid/agent/internal/api"
	"sentinelgrid/agent/internal/inventory"
)

const version = "0.1.0"

func main() {
	server :=
		flag.String(
			"server",
			"http://localhost:3000",
			"SentinelGrid server URL",
		)

	token :=
		flag.String(
			"token",
			"",
			"Enrollment token",
		)

	showInventory :=
		flag.Bool(
			"inventory",
			false,
			"Print system inventory",
		)

	showVersion :=
		flag.Bool(
			"version",
			false,
			"Print agent version",
		)

	flag.Parse()

	/* =========================
	   VERSION
	========================= */

	if *showVersion {
		fmt.Printf(
			"SentinelGrid Agent v%s\n",
			version,
		)

		return
	}

	fmt.Println()
	fmt.Println(
		"SentinelGrid Agent",
	)
	fmt.Printf(
		"Version: %s\n",
		version,
	)
	fmt.Println(
		"---------------------------",
	)

	/* =========================
	   INVENTORY
	========================= */

	systemInventory, err :=
		inventory.Collect()

	if err != nil {
		log.Fatalf(
			"Failed to collect inventory: %v",
			err,
		)
	}

	if *showInventory {
		data, err :=
			json.MarshalIndent(
				systemInventory,
				"",
				"  ",
			)

		if err != nil {
			log.Fatal(err)
		}

		fmt.Println(
			string(data),
		)

		return
	}

	/* =========================
	   TOKEN
	========================= */

	if *token == "" {
		fmt.Println(
			"No enrollment token provided.",
		)

		fmt.Println()
		fmt.Println(
			"Usage:",
		)

		fmt.Println(
			"sentinelgrid-agent --server http://localhost:3000 --token YOUR_TOKEN",
		)

		os.Exit(1)
	}

	/* =========================
	   ENROLLMENT
	========================= */

	fmt.Println(
		"Collecting device information...",
	)

	fmt.Printf(
		"Hostname: %s\n",
		systemInventory.Hostname,
	)

	fmt.Printf(
		"OS: %s/%s\n",
		systemInventory.OS,
		systemInventory.Arch,
	)

	fmt.Printf(
		"Local IP: %s\n",
		systemInventory.LocalIP,
	)

	fmt.Printf(
		"MAC: %s\n",
		systemInventory.MACAddress,
	)

	fmt.Println()
	fmt.Println(
		"Connecting to SentinelGrid...",
	)

	client :=
		api.NewClient(
			*server,
		)

	enrollment, err :=
		client.Enroll(
			*token,
			systemInventory,
		)

	if err != nil {
		log.Fatalf(
			"Enrollment failed: %v",
			err,
		)
	}

	/* =========================
	   SUCCESS
	========================= */

	fmt.Println()
	fmt.Println(
		"Device enrolled successfully.",
	)

	fmt.Printf(
		"Device ID: %s\n",
		enrollment.DeviceID,
	)

	fmt.Printf(
		"Agent ID: %s\n",
		enrollment.AgentID,
	)

	fmt.Println()
	fmt.Println(
		"SentinelGrid Agent is ready.",
	)
}