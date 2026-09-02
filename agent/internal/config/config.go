package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type Config struct {
	Server string `json:"server"`

	DeviceID string `json:"device_id"`

	AgentID string `json:"agent_id"`

	AgentToken string `json:"agent_token"`
}

/* =========================
   DIRECTORY
========================= */

func directoryPath() string {
	programData :=
		os.Getenv(
			"ProgramData",
		)

	if programData == "" {
		programData =
			`C:\ProgramData`
	}

	return filepath.Join(
		programData,
		"SentinelGrid",
	)
}

/* =========================
   FILE PATH
========================= */

func FilePath() string {
	return filepath.Join(
		directoryPath(),
		"agent.json",
	)
}

/* =========================
   SAVE
========================= */

func Save(
	cfg Config,
) error {

	dir :=
		directoryPath()

	err :=
		os.MkdirAll(
			dir,
			0755,
		)

	if err != nil {
		return fmt.Errorf(
			"could not create config directory: %w",
			err,
		)
	}

	data, err :=
		json.MarshalIndent(
			cfg,
			"",
			"  ",
		)

	if err != nil {
		return fmt.Errorf(
			"could not encode config: %w",
			err,
		)
	}

	err =
		os.WriteFile(
			FilePath(),
			data,
			0600,
		)

	if err != nil {
		return fmt.Errorf(
			"could not save config: %w",
			err,
		)
	}

	return nil
}

/* =========================
   LOAD
========================= */

func Load() (
	*Config,
	error,
) {

	data, err :=
		os.ReadFile(
			FilePath(),
		)

	if err != nil {
		return nil, err
	}

	var cfg Config

	err =
		json.Unmarshal(
			data,
			&cfg,
		)

	if err != nil {
		return nil,
			fmt.Errorf(
				"could not decode config: %w",
				err,
			)
	}

	/* =========================
	   BASIC VALIDATION
	========================= */

	if cfg.Server == "" {
		return nil,
			fmt.Errorf(
				"server is missing from agent configuration",
			)
	}

	if cfg.DeviceID == "" {
		return nil,
			fmt.Errorf(
				"device_id is missing from agent configuration",
			)
	}

	if cfg.AgentID == "" {
		return nil,
			fmt.Errorf(
				"agent_id is missing from agent configuration",
			)
	}

	if cfg.AgentToken == "" {
		return nil,
			fmt.Errorf(
				"agent_token is missing from agent configuration",
			)
	}

	return &cfg, nil
}