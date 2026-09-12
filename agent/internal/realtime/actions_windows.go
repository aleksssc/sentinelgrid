//go:build windows

package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"sentinelgrid/agent/internal/update"
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
	// Leave time to persist Windows' acceptance and deliver it before the OS stops us.
	if delay < 30 {
		delay = 30
	}
	flag := "/r"
	if commandType == "shutdown" {
		flag = "/s"
	}
	args := []string{flag, "/t", fmt.Sprint(delay)}
	if force {
		args = append(args, "/f")
	}
	result, err := runFixedCommand(ctx, 30*time.Second, "shutdown.exe", args...)
	result["action"] = commandType
	if err != nil {
		return result, "POWER_ACTION_FAILED", err
	}
	update.BeginShutdown()
	result["power_accepted"] = true
	result["scheduled_at"] = time.Now().Add(time.Duration(delay) * time.Second).UTC().Format(time.RFC3339)
	return result, "", nil
}

func executeLockAction(ctx context.Context) (map[string]any, string, error) {
	sessions, err := lockActiveInteractiveSessions(ctx)
	if err != nil {
		return map[string]any{"locked_sessions": sessions}, "LOCK_FAILED", err
	}
	return map[string]any{"action": "lock", "locked_sessions": sessions}, "", nil
}

func executeFlushDNS(ctx context.Context) (map[string]any, string, error) {
	result, err := runFixedCommand(ctx, time.Minute, "ipconfig.exe", "/flushdns")
	if err != nil {
		return result, "FLUSH_DNS_FAILED", err
	}
	return result, "", nil
}

func executeGPUpdate(ctx context.Context) (map[string]any, string, error) {
	result, err := runFixedCommand(ctx, 10*time.Minute, "gpupdate.exe", "/force", "/wait:540")
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return result, "GPUPDATE_TIMEOUT", err
		}
		return result, "GPUPDATE_FAILED", err
	}
	return result, "", nil
}

func runFixedCommand(parent context.Context, timeout time.Duration, program string, args ...string) (map[string]any, error) {
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	root, err := windows.GetSystemDirectory()
	if err != nil {
		return map[string]any{"exit_code": -1}, err
	}
	cmd := exec.CommandContext(ctx, filepath.Join(root, program), args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.CREATE_NO_WINDOW}
	stdout, stderr := &limitedBuffer{limit: 4096}, &limitedBuffer{limit: 4096}
	cmd.Stdout, cmd.Stderr, cmd.Stdin = stdout, stderr, nil
	cmd.WaitDelay = 5 * time.Second
	err = cmd.Run()
	exit := -1
	if cmd.ProcessState != nil {
		exit = cmd.ProcessState.ExitCode()
	}
	result := map[string]any{"exit_code": exit, "stdout": boundedActionOutput(stdout.String()), "stderr": boundedActionOutput(stderr.String())}
	if ctx.Err() != nil {
		return result, fmt.Errorf("Windows action timed out or was cancelled: %w", ctx.Err())
	}
	if err != nil {
		return result, fmt.Errorf("%s failed (exit code %d): %w", program, exit, err)
	}
	return result, nil
}

func LockInteractiveSession() error {
	result, _, err := windows.NewLazySystemDLL("user32.dll").NewProc("LockWorkStation").Call()
	if result == 0 {
		return fmt.Errorf("Windows rejected the session lock: %v", err)
	}
	return nil
}

func lockActiveInteractiveSessions(ctx context.Context) ([]uint32, error) {
	var sessions *windows.WTS_SESSION_INFO
	var count uint32
	if err := windows.WTSEnumerateSessions(0, 0, 1, &sessions, &count); err != nil {
		return nil, err
	}
	defer windows.WTSFreeMemory(uintptr(unsafe.Pointer(sessions)))
	var locked []uint32
	for _, session := range unsafe.Slice(sessions, count) {
		if session.State != windows.WTSActive || session.SessionID == 0 {
			continue
		}
		if err := lockSession(ctx, session.SessionID); err != nil {
			return locked, err
		}
		locked = append(locked, session.SessionID)
	}
	if len(locked) == 0 {
		return nil, fmt.Errorf("no active interactive Windows session")
	}
	return locked, nil
}

func lockSession(parent context.Context, session uint32) error {
	locked, err := sessionLocked(session)
	if err != nil || locked {
		return err
	}
	var token windows.Token
	if err := windows.WTSQueryUserToken(session, &token); err != nil {
		return err
	}
	defer token.Close()
	root, err := windows.KnownFolderPath(windows.FOLDERID_ProgramFiles, 0)
	if err != nil {
		return err
	}
	executable := filepath.Join(root, "SentinelGrid", "SentinelGridAgent.exe")
	app, err := windows.UTF16PtrFromString(executable)
	if err != nil {
		return err
	}
	line, err := windows.UTF16FromString(`"` + executable + `" -lock-session`)
	if err != nil {
		return err
	}
	desktop, err := windows.UTF16PtrFromString(`winsta0\default`)
	if err != nil {
		return err
	}
	startup := windows.StartupInfo{Cb: uint32(unsafe.Sizeof(windows.StartupInfo{})), Desktop: desktop}
	var process windows.ProcessInformation
	if err := windows.CreateProcessAsUser(token, app, &line[0], nil, nil, false, windows.CREATE_NO_WINDOW, nil, nil, &startup, &process); err != nil {
		return err
	}
	defer windows.CloseHandle(process.Process)
	defer windows.CloseHandle(process.Thread)
	ctx, cancel := context.WithTimeout(parent, 15*time.Second)
	defer cancel()
	for {
		state, err := windows.WaitForSingleObject(process.Process, 100)
		if err != nil {
			return err
		}
		if state == windows.WAIT_OBJECT_0 {
			var code uint32
			if err := windows.GetExitCodeProcess(process.Process, &code); err != nil {
				return err
			}
			if code != 0 {
				return fmt.Errorf("Windows session lock failed (exit code %d)", code)
			}
			for {
				locked, err := sessionLocked(session)
				if err != nil {
					return err
				}
				if locked {
					return nil
				}
				select {
				case <-ctx.Done():
					return fmt.Errorf("Windows did not confirm session lock: %w", ctx.Err())
				case <-time.After(100 * time.Millisecond):
				}
			}
		}
		if err := ctx.Err(); err != nil {
			return err
		}
	}
}

func sessionLocked(session uint32) (bool, error) {
	var buffer unsafe.Pointer
	var size uint32
	result, _, callErr := windows.NewLazySystemDLL("wtsapi32.dll").NewProc("WTSQuerySessionInformationW").Call(0, uintptr(session), 25, uintptr(unsafe.Pointer(&buffer)), uintptr(unsafe.Pointer(&size)))
	if result == 0 {
		return false, fmt.Errorf("could not confirm Windows lock state: %v", callErr)
	}
	defer windows.WTSFreeMemory(uintptr(buffer))
	// WTSINFOEX level 1: union is 8-byte aligned and SessionFlags follows ID/state.
	if size < 20 {
		return false, fmt.Errorf("invalid Windows session information")
	}
	info := (*struct {
		Level     uint32
		Padding   uint32
		SessionID uint32
		State     uint32
		Flags     int32
	})(buffer)
	if info.Level != 1 || info.SessionID != session {
		return false, fmt.Errorf("Windows session information mismatch")
	}
	return info.Flags == 0, nil
}

func boundedActionOutput(text string) string {
	for {
		encoded, _ := json.Marshal(text)
		if len(encoded) <= 4096 {
			return text
		}
		text = text[:len(text)/2] + "\n[output truncated]"
	}
}
