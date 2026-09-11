//go:build windows

package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"time"

	"golang.org/x/sys/windows/svc"
	buildinfo "sentinelgrid/agent"
	"sentinelgrid/agent/internal/update"
)

type recoveryService struct{}

func (recoveryService) Execute(_ []string, requests <-chan svc.ChangeRequest, changes chan<- svc.Status) (bool, uint32) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() { defer close(done); update.RunRecovery(ctx) }()
	status := svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown | svc.AcceptPreShutdown}
	changes <- status
	for request := range requests {
		switch request.Cmd {
		case svc.Interrogate:
			changes <- status
		case svc.Stop, svc.Shutdown, svc.PreShutdown:
			update.BeginShutdown()
			cancel()
			changes <- svc.Status{State: svc.StopPending, WaitHint: 90000}
			ticker := time.NewTicker(5 * time.Second)
			defer ticker.Stop()
			checkpoint := uint32(1)
			for {
				select {
				case <-done:
					return false, 0
				case <-ticker.C:
					checkpoint++
					changes <- svc.Status{State: svc.StopPending, CheckPoint: checkpoint, WaitHint: 90000}
				}
			}
		}
	}
	cancel()
	<-done
	return false, 0
}

func main() {
	version := flag.Bool("version", false, "Show updater version")
	protocol := flag.Bool("protocol", false, "Show fixed journal protocol")
	configure := flag.Bool("configure-recovery", false, "Configure fixed recovery service restart policy")
	maintenanceBegin := flag.Bool("maintenance-begin", false, "Quiesce only SentinelGrid update recovery for MSI")
	maintenanceEnd := flag.Bool("maintenance-end", false, "Finish only SentinelGrid MSI maintenance")
	showTrust := flag.Bool("update-build-info", false, "Show embedded update trust (no update)")
	flag.Parse()
	if flag.NArg() != 0 {
		log.Fatal("Updater accepts no positional arguments")
	}
	modes := 0
	for _, enabled := range []bool{*version, *protocol, *configure, *maintenanceBegin, *maintenanceEnd, *showTrust} {
		if enabled {
			modes++
		}
	}
	if modes > 1 {
		log.Fatal("Conflicting updater modes")
	}
	if *showTrust {
		fmt.Println(update.BuildTrustJSON())
		return
	}
	if *version {
		fmt.Printf("SentinelGrid Updater %s\n", buildinfo.Version())
		return
	}
	if *protocol {
		fmt.Println(update.Protocol)
		return
	}
	if *configure {
		if err := update.ConfigureRecovery(); err != nil {
			log.Fatal(err)
		}
		return
	}
	if *maintenanceBegin || *maintenanceEnd {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		if err := update.Maintenance(ctx, *maintenanceBegin); err != nil {
			log.Fatal(err)
		}
		return
	}
	isService, err := svc.IsWindowsService()
	if err != nil || !isService {
		log.Fatal("Updater execution requires the fixed Windows recovery service")
	}
	if err := svc.Run(update.RecoveryServiceName, recoveryService{}); err != nil {
		log.Fatal(err)
	}
}
