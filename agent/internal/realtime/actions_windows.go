//go:build windows

package realtime

import (
	"context"
	"fmt"
	"log"
	"os/exec"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"sentinelgrid/agent/internal/update"
)

const createUnicodeEnvironment = 0x00000400

type processStartupInfo struct {
	cb            uint32
	reserved      *uint16
	desktop       *uint16
	title         *uint16
	x             uint32
	y             uint32
	xSize         uint32
	ySize         uint32
	xCountChars   uint32
	yCountChars   uint32
	fillAttribute uint32
	flags         uint32
	showWindow    uint16
	reserved2     uint16
	reserved2Ptr  *byte
	stdin         windows.Handle
	stdout        windows.Handle
	stderr        windows.Handle
}

type processInformation struct {
	process   windows.Handle
	thread    windows.Handle
	processID uint32
	threadID  uint32
}

var (
	wtsDLL              = syscall.NewLazyDLL("wtsapi32.dll")
	wtsGetActiveConsole = wtsDLL.NewProc("WTSGetActiveConsoleSessionId")
	wtsQueryUserToken   = wtsDLL.NewProc("WTSQueryUserToken")
	advapiDLL           = syscall.NewLazyDLL("advapi32.dll")
	createProcessAsUser = advapiDLL.NewProc("CreateProcessAsUserW")
)

func executePowerAction(ctx context.Context, commandType string, delay int, force bool) (map[string]any, string, error) {
	unlock, err := update.GuardPowerAction(ctx)
	if err != nil {
		return nil, "UPDATE_BUSY", err
	}
	defer func() {
		if err := unlock(); err != nil {
			log.Printf("Update power-action coordination: %v", err)
		}
	}()
	flag := "/r"
	if commandType == "shutdown" {
		flag = "/s"
	}

	args := []string{flag, "/t", fmt.Sprintf("%d", delay)}
	if force {
		args = append(args, "/f")
	}

	output, err := runFixedCommand(ctx, "shutdown.exe", args...)
	if err != nil {
		return nil, "POWER_ACTION_FAILED", err
	}

	return map[string]any{"action": commandType, "output": output}, "", nil
}

func executeLockAction(ctx context.Context) (map[string]any, string, error) {
	if err := lockActiveInteractiveSession(); err != nil {
		return nil, "LOCK_FAILED", err
	}

	return map[string]any{"action": "lock", "session": "active_console"}, "", nil
}

func executeFlushDNS(ctx context.Context) (map[string]any, string, error) {
	output, err := runFixedCommand(ctx, "ipconfig.exe", "/flushdns")
	if err != nil {
		return nil, "FLUSH_DNS_FAILED", err
	}

	return map[string]any{"action": "flush_dns", "output": output}, "", nil
}

func executeGPUpdate(ctx context.Context) (map[string]any, string, error) {
	output, err := runFixedCommand(ctx, "gpupdate.exe", "/target:computer", "/force")
	lower := strings.ToLower(output)
	if strings.Contains(lower, "not joined to a domain") || strings.Contains(lower, "not domain joined") {
		return nil, "NOT_DOMAIN_JOINED", fmt.Errorf("the computer is not joined to a domain")
	}
	if err != nil {
		return nil, "GPUPDATE_FAILED", err
	}

	return map[string]any{"action": "gpupdate", "output": output}, "", nil
}

func runFixedCommand(parent context.Context, program string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(parent, 60*time.Second)
	defer cancel()

	output, err := exec.CommandContext(ctx, program, args...).CombinedOutput()
	text := strings.TrimSpace(string(output))
	if len(text) > 8192 {
		text = text[:8192] + "\n[output truncated]"
	}
	if ctx.Err() != nil {
		return text, fmt.Errorf("the action timed out")
	}
	if err != nil {
		return text, fmt.Errorf("the Windows action failed")
	}
	return text, nil
}

func lockActiveInteractiveSession() error {
	sessionID, _, _ := wtsGetActiveConsole.Call()
	if sessionID == 0xffffffff {
		return fmt.Errorf("could not find the active Windows session")
	}

	var token windows.Token
	result, _, callErr := wtsQueryUserToken.Call(sessionID, uintptr(unsafe.Pointer(&token)))
	if result == 0 || callErr != syscall.Errno(0) {
		return fmt.Errorf("could not access the active Windows session")
	}
	defer token.Close()

	commandLine, err := windows.UTF16FromString("rundll32.exe user32.dll,LockWorkStation")
	if err != nil {
		return fmt.Errorf("could not prepare the lock action")
	}
	desktop, err := windows.UTF16PtrFromString("winsta0\\default")
	if err != nil {
		return fmt.Errorf("could not prepare the interactive desktop")
	}

	startup := processStartupInfo{
		cb:      uint32(unsafe.Sizeof(processStartupInfo{})),
		desktop: desktop,
	}
	var info processInformation

	result, _, callErr = createProcessAsUser.Call(
		uintptr(token),
		0,
		uintptr(unsafe.Pointer(&commandLine[0])),
		0,
		0,
		1,
		createUnicodeEnvironment,
		0,
		0,
		uintptr(unsafe.Pointer(&startup)),
		uintptr(unsafe.Pointer(&info)),
	)
	if result == 0 {
		return fmt.Errorf("could not start the lock action in the active session")
	}

	windows.CloseHandle(info.thread)
	windows.CloseHandle(info.process)
	return nil
}
