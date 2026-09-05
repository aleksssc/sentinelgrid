package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/kardianos/service"

	"sentinelgrid/agent/internal/api"
	"sentinelgrid/agent/internal/config"
	"sentinelgrid/agent/internal/inventory"
	"sentinelgrid/agent/internal/metrics"
	"sentinelgrid/agent/internal/realtime"
)

/* =========================
   AGENT
========================= */

const version = "0.1.2"

const defaultServerURL =
	"https://sentinelgrid-one.vercel.app"

const heartbeatInterval =
	30 * time.Second

const inventoryRefreshInterval =
	30 * time.Minute

/* =========================
   WINDOWS SERVICE
========================= */

type program struct {
	stop chan struct{}
	done chan struct{}
}

/* =========================
   SERVICE START
========================= */

func (p *program) Start(
	s service.Service,
) error {
	p.stop =
		make(
			chan struct{},
		)

	p.done =
		make(
			chan struct{},
		)

	go p.run()

	return nil
}

/* =========================
   SERVICE LOOP
========================= */

func (p *program) run() {
	defer close(
		p.done,
	)

	log.Printf(
		"SentinelGrid Agent %s service started.",
		version,
	)

	/* =========================
		REALTIME
	========================= */

		realtimeContext,
			cancelRealtime :=
			context.WithCancel(
				context.Background(),
			)

		defer cancelRealtime()

		go realtime.Run(
			realtimeContext,
		)

	/* =========================
	   LOAD CONFIG
	========================= */

	cfg, err :=
		config.Load()

	if err != nil {
		log.Printf(
			"Agent configuration not available: %v",
			err,
		)
	}

	/* =========================
	   API CLIENT
	========================= */

	var client *api.Client

	if cfg != nil {
		client =
			api.NewClient(
				cfg.Server,
			)
	}

	/* =========================
	   INVENTORY CACHE
	========================= */

	var cachedInventory *
		inventory.Inventory

	lastInventoryRefresh :=
		time.Time{}

	refreshInventory :=
		func() {
			collected,
				err :=
				inventory.Collect(
					version,
				)

			if err != nil {
				log.Printf(
					"Inventory collection failed: %v",
					err,
				)

				return
			}

			cachedInventory =
				&collected

			lastInventoryRefresh =
				time.Now()

			log.Printf(
				"Inventory collected. Hostname: %s | OS: %s | Arch: %s | Manufacturer: %s | Model: %s | Agent: %s",
				collected.Hostname,
				collected.OS,
				collected.Arch,
				collected.Manufacturer,
				collected.Model,
				collected.AgentVersion,
			)
		}

	/*
		Collect immediately.

		Inventory is then cached in memory and
		sent with every heartbeat.
	*/

	refreshInventory()

	/* =========================
	   INITIAL HEARTBEAT
	========================= */

	if cfg != nil &&
		client != nil {
		sendHeartbeat(
			client,
			cfg,
			cachedInventory,
		)
	}

	/* =========================
	   HEARTBEAT TIMER
	========================= */

	ticker :=
		time.NewTicker(
			heartbeatInterval,
		)

	defer ticker.Stop()

	/* =========================
	   MAIN LOOP
	========================= */

	for {
		select {

		case <-ticker.C:

			/* =========================
			   LOAD CONFIG IF NEEDED
			========================= */

			if cfg == nil ||
				client == nil {
				loadedConfig,
					err :=
					config.Load()

				if err != nil {
					log.Println(
						"Waiting for Agent enrollment.",
					)

					continue
				}

				cfg =
					loadedConfig

				client =
					api.NewClient(
						cfg.Server,
					)

				log.Printf(
					"Agent configuration loaded. Device: %s",
					cfg.DeviceID,
				)

				/*
					The device may have been enrolled
					after service startup, so refresh
					inventory immediately.
				*/

				refreshInventory()
			}

			/* =========================
			   REFRESH INVENTORY
			========================= */

			if cachedInventory ==
				nil ||
				lastInventoryRefresh.
					IsZero() ||
				time.Since(
					lastInventoryRefresh,
				) >=
					inventoryRefreshInterval {
				refreshInventory()
			}

			/* =========================
			   HEARTBEAT
			========================= */

			sendHeartbeat(
				client,
				cfg,
				cachedInventory,
			)

		case <-p.stop:

			log.Println(
				"SentinelGrid Agent service stopping.",
			)

			return
		}
	}
}

/* =========================
   SEND HEARTBEAT
========================= */

func sendHeartbeat(
	client *api.Client,
	cfg *config.Config,
	cachedInventory *inventory.Inventory,
) {
	if client == nil ||
		cfg == nil {
		return
	}

	/* =========================
	   COLLECT LIVE METRICS
	========================= */

	deviceMetrics, err :=
		metrics.Collect()

	if err != nil {
		log.Printf(
			"Telemetry collection failed: %v",
			err,
		)

		/*
			If telemetry fails we still send
			a basic heartbeat so the device
			does not incorrectly appear offline.
		*/

		response,
			heartbeatErr :=
			client.Heartbeat(
				cfg.AgentToken,
			)

		if heartbeatErr != nil {
			log.Printf(
				"Heartbeat failed: %v",
				heartbeatErr,
			)

			return
		}

		log.Printf(
			"Heartbeat sent without telemetry. Device: %s",
			response.DeviceID,
		)

		return
	}

	/* =========================
	   HEARTBEAT + INVENTORY
	========================= */

	response, err :=
		client.
			HeartbeatWithData(
				cfg.AgentToken,
				api.HeartbeatData{
					Metrics:
						deviceMetrics,

					Inventory:
						cachedInventory,
				},
			)

	if err != nil {
		log.Printf(
			"Heartbeat failed: %v",
			err,
		)

		return
	}

	/* =========================
	   LOG
	========================= */

	if cachedInventory != nil {
		log.Printf(
			"Heartbeat sent. Device: %s | CPU %.1f%% | RAM %.1f%% | Disk %.1f%% | Agent %s",
			response.DeviceID,
			deviceMetrics.CPUUsage,
			deviceMetrics.RAMUsage,
			deviceMetrics.DiskUsage,
			cachedInventory.AgentVersion,
		)

		return
	}

	log.Printf(
		"Heartbeat sent. Device: %s | CPU %.1f%% | RAM %.1f%% | Disk %.1f%%",
		response.DeviceID,
		deviceMetrics.CPUUsage,
		deviceMetrics.RAMUsage,
		deviceMetrics.DiskUsage,
	)
}

/* =========================
   SERVICE STOP
========================= */

func (p *program) Stop(
	s service.Service,
) error {
	if p.stop != nil {
		close(
			p.stop,
		)
	}

	if p.done != nil {
		<-p.done
	}

	return nil
}

/* =========================
   CLI
========================= */

func runCLI(
	serverURL string,
	enrollmentToken string,
	showInventory bool,
) error {
	serverURL =
		strings.TrimSpace(
			serverURL,
		)

	enrollmentToken =
		strings.TrimSpace(
			enrollmentToken,
		)

	/* =========================
	   SERVER
	========================= */

	if serverURL == "" {
		return fmt.Errorf(
			"SentinelGrid server URL is required",
		)
	}

	/* =========================
	   INVENTORY
	========================= */

	deviceInventory, err :=
		inventory.Collect(
			version,
		)

	if err != nil {
		return fmt.Errorf(
			"could not collect inventory: %w",
			err,
		)
	}

	/* =========================
	   SHOW INVENTORY
	========================= */

	if showInventory {
		fmt.Println(
			"SentinelGrid Agent Inventory",
		)

		fmt.Println(
			"---------------------------",
		)

		fmt.Printf(
			"Hostname: %s\n",
			deviceInventory.Hostname,
		)

		fmt.Printf(
			"Operating System: %s\n",
			deviceInventory.OS,
		)

		fmt.Printf(
			"OS Version: %s\n",
			deviceInventory.OSVersion,
		)

		fmt.Printf(
			"OS Build: %s\n",
			deviceInventory.OSBuild,
		)

		fmt.Printf(
			"Architecture: %s\n",
			deviceInventory.Arch,
		)

		fmt.Printf(
			"Manufacturer: %s\n",
			deviceInventory.Manufacturer,
		)

		fmt.Printf(
			"Model: %s\n",
			deviceInventory.Model,
		)

		fmt.Printf(
			"Serial Number: %s\n",
			deviceInventory.SerialNumber,
		)

		fmt.Printf(
			"Processor: %s\n",
			deviceInventory.CPUName,
		)

		fmt.Printf(
			"RAM Total: %d bytes\n",
			deviceInventory.RAMTotalBytes,
		)

		fmt.Printf(
			"Local IP: %s\n",
			deviceInventory.LocalIP,
		)

		fmt.Printf(
			"MAC Address: %s\n",
			deviceInventory.MACAddress,
		)

		fmt.Printf(
			"Agent Version: %s\n",
			deviceInventory.AgentVersion,
		)

		return nil
	}

	/* =========================
	   VALIDATE TOKEN
	========================= */

	if enrollmentToken == "" {
		return fmt.Errorf(
			"enrollment token is required",
		)
	}

	if !strings.HasPrefix(
		enrollmentToken,
		"SG-ENROLL-",
	) {
		return fmt.Errorf(
			"invalid SentinelGrid enrollment token",
		)
	}

	/* =========================
	   API CLIENT
	========================= */

	client :=
		api.NewClient(
			serverURL,
		)

	/* =========================
	   ENROLL
	========================= */

	log.Printf(
		"Enrolling device with SentinelGrid server: %s",
		serverURL,
	)

	response, err :=
		client.Enroll(
			enrollmentToken,
			deviceInventory,
		)

	if err != nil {
		return fmt.Errorf(
			"enrollment failed: %w",
			err,
		)
	}

	/* =========================
	   SAVE CONFIG
	========================= */

	err =
		config.Save(
			config.Config{
				Server:
					serverURL,

				DeviceID:
					response.DeviceID,

				AgentID:
					response.AgentID,

				AgentToken:
					response.AgentToken,
			},
		)

	if err != nil {
		return fmt.Errorf(
			"could not save agent configuration: %w",
			err,
		)
	}

	/* =========================
	   RESULT
	========================= */

	fmt.Println()

	fmt.Println(
		"Device enrolled successfully.",
	)

	fmt.Println()

	fmt.Printf(
		"Device ID: %s\n",
		response.DeviceID,
	)

	fmt.Printf(
		"Agent ID: %s\n",
		response.AgentID,
	)

	fmt.Printf(
		"Configuration saved to: %s\n",
		config.FilePath(),
	)

	fmt.Println()

	fmt.Println(
		"SentinelGrid Agent is ready.",
	)

	return nil
}

/* =========================
   MSI ENROLLMENT TOKEN
========================= */

func enrollmentTokenFromInstallerPath(
	installerPath string,
) (
	string,
	error,
) {
	if strings.TrimSpace(
		installerPath,
	) == "" {
		return "",
			fmt.Errorf(
				"installer path is required",
			)
	}

	fileName :=
		filepath.Base(
			installerPath,
		)

	const prefix =
		"SentinelGridAgent__"

	const suffix =
		".msi"

	/* =========================
	   PREFIX
	========================= */

	if !strings.HasPrefix(
		fileName,
		prefix,
	) {
		return "",
			fmt.Errorf(
				"invalid SentinelGrid installer filename: %s",
				fileName,
			)
	}

	/* =========================
	   EXTENSION
	========================= */

	if !strings.HasSuffix(
		strings.ToLower(
			fileName,
		),
		suffix,
	) {
		return "",
			fmt.Errorf(
				"invalid installer extension",
			)
	}

	/* =========================
	   TOKEN
	========================= */

	token := fileName[len(prefix) : len(fileName)-len(suffix)]

	token =
		strings.TrimSpace(
			token,
		)

	if !strings.HasPrefix(
		token,
		"SG-ENROLL-",
	) {
		return "",
			fmt.Errorf(
				"invalid enrollment token",
			)
	}

	return token,
		nil
}

/* =========================
   MAIN
========================= */

func main() {
	/* =========================
	   FLAGS
	========================= */

	serverURL :=
		flag.String(
			"server",
			defaultServerURL,
			"SentinelGrid server URL",
		)

	enrollmentToken :=
		flag.String(
			"token",
			"",
			"SentinelGrid enrollment token",
		)

	installerPath :=
		flag.String(
			"installer",
			"",
			"Original SentinelGrid MSI path",
		)

	showInventory :=
		flag.Bool(
			"inventory",
			false,
			"Show device inventory",
		)

	showVersion :=
		flag.Bool(
			"version",
			false,
			"Show Agent version",
		)

	flag.Parse()

	/* =========================
	   VERSION
	========================= */

	if *showVersion {
		fmt.Printf(
			"SentinelGrid Agent %s\n",
			version,
		)

		return
	}

	/* =========================
	   MSI ENROLLMENT MODE
	========================= */

	if *installerPath != "" {
		token, err :=
			enrollmentTokenFromInstallerPath(
				*installerPath,
			)

		if err != nil {
			fmt.Fprintf(
				os.Stderr,
				"Installer enrollment error: %v\n",
				err,
			)

			os.Exit(1)
		}

		err =
			runCLI(
				*serverURL,
				token,
				false,
			)

		if err != nil {
			fmt.Fprintf(
				os.Stderr,
				"Enrollment error: %v\n",
				err,
			)

			os.Exit(1)
		}

		return
	}

	/* =========================
	   MANUAL CLI MODE
	========================= */

	if *showInventory ||
		*enrollmentToken != "" {
		err :=
			runCLI(
				*serverURL,
				*enrollmentToken,
				*showInventory,
			)

		if err != nil {
			fmt.Fprintf(
				os.Stderr,
				"Error: %v\n",
				err,
			)

			os.Exit(1)
		}

		return
	}

	/* =========================
	   WINDOWS SERVICE
	========================= */

	serviceConfig :=
		&service.Config{
			Name:
				"SentinelGridAgent",

			DisplayName:
				"SentinelGrid Agent",

			Description:
				"SentinelGrid monitoring and remote management agent.",
		}

	program :=
		&program{}

	svc, err :=
		service.New(
			program,
			serviceConfig,
		)

	if err != nil {
		log.Fatal(
			err,
		)
	}

	if err :=
		svc.Run(); err != nil {
		log.Fatal(
			err,
		)
	}
}