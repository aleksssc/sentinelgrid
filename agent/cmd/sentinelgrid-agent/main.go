package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/kardianos/service"

	"sentinelgrid/agent/internal/api"
	"sentinelgrid/agent/internal/config"
	"sentinelgrid/agent/internal/inventory"
)

const version = "0.1.0"

const defaultServerURL = "https://sentinelgrid-one.vercel.app"

/* =========================
   WINDOWS SERVICE
========================= */

type program struct {
	stop chan struct{}
	done chan struct{}
}

func (p *program) Start(
	s service.Service,
) error {

	p.stop =
		make(chan struct{})

	p.done =
		make(chan struct{})

	go p.run()

	return nil
}

func (p *program) run() {

	defer close(
		p.done,
	)

	log.Println(
		"SentinelGrid Agent service started.",
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
	   INITIAL HEARTBEAT
	========================= */

	if cfg != nil &&
		client != nil {

		response, err :=
			client.Heartbeat(
				cfg.AgentToken,
			)

		if err != nil {

			log.Printf(
				"Initial heartbeat failed: %v",
				err,
			)

		} else {

			log.Printf(
				"Heartbeat sent successfully. Device: %s",
				response.DeviceID,
			)
		}
	}

	/* =========================
	   HEARTBEAT LOOP
	========================= */

	ticker :=
		time.NewTicker(
			30 * time.Second,
		)

	defer ticker.Stop()

	for {

		select {

		case <-ticker.C:

			/* =========================
			   LOAD CONFIG IF NEEDED
			========================= */

			if cfg == nil ||
				client == nil {

				loadedConfig, err :=
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
			}

			/* =========================
			   HEARTBEAT
			========================= */

			response, err :=
				client.Heartbeat(
					cfg.AgentToken,
				)

			if err != nil {

				log.Printf(
					"Heartbeat failed: %v",
					err,
				)

				continue
			}

			log.Printf(
				"Heartbeat sent. Device: %s",
				response.DeviceID,
			)

		case <-p.stop:

			log.Println(
				"SentinelGrid Agent service stopping.",
			)

			return
		}
	}
}

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
	   VALIDATE SERVER
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
		inventory.Collect()

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
			"OS: %s\n",
			deviceInventory.OS,
		)

		fmt.Printf(
			"Arch: %s\n",
			deviceInventory.Arch,
		)

		fmt.Printf(
			"Local IP: %s\n",
			deviceInventory.LocalIP,
		)

		fmt.Printf(
			"MAC: %s\n",
			deviceInventory.MACAddress,
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
	   ENROLL DEVICE
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
	   SUCCESS
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
	   CLI / ENROLLMENT MODE
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
	   WINDOWS SERVICE MODE
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

	/* =========================
	   RUN SERVICE
	========================= */

	if err :=
		svc.Run(); err != nil {

		log.Fatal(
			err,
		)
	}
}