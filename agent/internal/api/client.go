package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"sentinelgrid/agent/internal/inventory"
	"sentinelgrid/agent/internal/metrics"
)

/* =========================
   CLIENT
========================= */

type Client struct {
	serverURL string

	httpClient *http.Client
}

/* =========================
   ENROLL RESPONSE
========================= */

type EnrollResponse struct {
	DeviceID string `json:"device_id"`

	AgentID string `json:"agent_id"`

	AgentToken string `json:"agent_token"`
}

/* =========================
   HEARTBEAT RESPONSE
========================= */

type HeartbeatResponse struct {
	OK bool `json:"ok"`

	DeviceID string `json:"device_id"`
}

/* =========================
   HEARTBEAT DATA
========================= */

type HeartbeatData struct {
	Metrics metrics.Metrics

	Inventory *inventory.Inventory
}

/* =========================
   ENROLL REQUEST
========================= */

/*
	We send the inventory both flat and nested.

	This keeps compatibility with the current
	SentinelGrid enrollment implementation while
	also giving us a cleaner inventory object for
	future API versions.
*/

type enrollRequest struct {
	Token string `json:"token"`

	EnrollmentToken string `json:"enrollment_token"`

	Inventory inventory.Inventory `json:"inventory"`

	Hostname string `json:"hostname"`

	OS string `json:"os"`

	OSVersion string `json:"os_version"`

	OSBuild string `json:"os_build"`

	Arch string `json:"arch"`

	LocalIP string `json:"local_ip"`

	MACAddress string `json:"mac_address"`

	Manufacturer string `json:"manufacturer"`

	Model string `json:"model"`

	SerialNumber string `json:"serial_number"`

	CPUName string `json:"cpu_name"`

	RAMTotalBytes uint64 `json:"ram_total_bytes"`

	AgentVersion string `json:"agent_version"`
}

/* =========================
   HEARTBEAT REQUEST
========================= */

type heartbeatRequest struct {
	/*
		Body token is kept as fallback.

		The primary authentication method
		is still Authorization: Bearer.
	*/

	AgentToken string `json:"agent_token,omitempty"`

	Token string `json:"token,omitempty"`

	CPUUsage *float64 `json:"cpu_usage,omitempty"`

	RAMUsage *float64 `json:"ram_usage,omitempty"`

	RAMTotalBytes *uint64 `json:"ram_total_bytes,omitempty"`

	RAMUsedBytes *uint64 `json:"ram_used_bytes,omitempty"`

	DiskUsage *float64 `json:"disk_usage,omitempty"`

	DiskTotalBytes *uint64 `json:"disk_total_bytes,omitempty"`

	DiskUsedBytes *uint64 `json:"disk_used_bytes,omitempty"`

	UptimeSeconds *uint64 `json:"uptime_seconds,omitempty"`

	Inventory *inventory.Inventory `json:"inventory,omitempty"`
}

/* =========================
   NEW CLIENT
========================= */

func NewClient(
	serverURL string,
) *Client {

	return &Client{
		serverURL:
			strings.TrimRight(
				strings.TrimSpace(
					serverURL,
				),
				"/",
			),

		httpClient:
			&http.Client{
				Timeout:
					20 *
						time.Second,
			},
	}
}

/* =========================
   ENROLL
========================= */

func (c *Client) Enroll(
	enrollmentToken string,
	deviceInventory inventory.Inventory,
) (
	*EnrollResponse,
	error,
) {

	requestBody :=
		enrollRequest{
			Token:
				enrollmentToken,

			EnrollmentToken:
				enrollmentToken,

			Inventory:
				deviceInventory,

			Hostname:
				deviceInventory.Hostname,

			OS:
				deviceInventory.OS,

			OSVersion:
				deviceInventory.OSVersion,

			OSBuild:
				deviceInventory.OSBuild,

			Arch:
				deviceInventory.Arch,

			LocalIP:
				deviceInventory.LocalIP,

			MACAddress:
				deviceInventory.MACAddress,

			Manufacturer:
				deviceInventory.Manufacturer,

			Model:
				deviceInventory.Model,

			SerialNumber:
				deviceInventory.SerialNumber,

			CPUName:
				deviceInventory.CPUName,

			RAMTotalBytes:
				deviceInventory.RAMTotalBytes,

			AgentVersion:
				deviceInventory.AgentVersion,
		}

	var response EnrollResponse

	err :=
		c.postJSON(
			"/api/agent/enroll",
			requestBody,
			"",
			&response,
		)

	if err != nil {

		return nil,
			err
	}

	if strings.TrimSpace(
		response.DeviceID,
	) == "" {

		return nil,
			fmt.Errorf(
				"enrollment response did not include device_id",
			)
	}

	if strings.TrimSpace(
		response.AgentToken,
	) == "" {

		return nil,
			fmt.Errorf(
				"enrollment response did not include agent_token",
			)
	}

	return &response,
		nil
}

/* =========================
   BASIC HEARTBEAT
========================= */

func (c *Client) Heartbeat(
	agentToken string,
) (
	*HeartbeatResponse,
	error,
) {

	return c.heartbeat(
		agentToken,
		nil,
	)
}

/* =========================
   HEARTBEAT WITH DATA
========================= */

func (c *Client) HeartbeatWithData(
	agentToken string,
	data HeartbeatData,
) (
	*HeartbeatResponse,
	error,
) {

	return c.heartbeat(
		agentToken,
		&data,
	)
}

/* =========================
   HEARTBEAT INTERNAL
========================= */

func (c *Client) heartbeat(
	agentToken string,
	data *HeartbeatData,
) (
	*HeartbeatResponse,
	error,
) {

	requestBody :=
		heartbeatRequest{
			AgentToken:
				agentToken,

			Token:
				agentToken,
		}

	if data != nil {

		requestBody.CPUUsage =
			float64Pointer(
				data.Metrics.CPUUsage,
			)

		requestBody.RAMUsage =
			float64Pointer(
				data.Metrics.RAMUsage,
			)

		requestBody.RAMTotalBytes =
			uint64Pointer(
				data.Metrics.RAMTotalBytes,
			)

		requestBody.RAMUsedBytes =
			uint64Pointer(
				data.Metrics.RAMUsedBytes,
			)

		requestBody.DiskUsage =
			float64Pointer(
				data.Metrics.DiskUsage,
			)

		requestBody.DiskTotalBytes =
			uint64Pointer(
				data.Metrics.DiskTotalBytes,
			)

		requestBody.DiskUsedBytes =
			uint64Pointer(
				data.Metrics.DiskUsedBytes,
			)

		requestBody.UptimeSeconds =
			uint64Pointer(
				data.Metrics.UptimeSeconds,
			)

		requestBody.Inventory =
			data.Inventory
	}

	var response HeartbeatResponse

	err :=
		c.postJSON(
			"/api/agent/heartbeat",
			requestBody,
			agentToken,
			&response,
		)

	if err != nil {

		return nil,
			err
	}

	return &response,
		nil
}

/* =========================
   POST JSON
========================= */

func (c *Client) postJSON(
	path string,
	body any,
	bearerToken string,
	responseTarget any,
) error {

	data, err :=
		json.Marshal(
			body,
		)

	if err != nil {

		return fmt.Errorf(
			"could not encode request: %w",
			err,
		)
	}

	request, err :=
		http.NewRequest(
			http.MethodPost,
			c.serverURL+
				path,
			bytes.NewReader(
				data,
			),
		)

	if err != nil {

		return fmt.Errorf(
			"could not create request: %w",
			err,
		)
	}

	request.Header.Set(
		"Content-Type",
		"application/json",
	)

	request.Header.Set(
		"Accept",
		"application/json",
	)

	if strings.TrimSpace(
		bearerToken,
	) != "" {

		request.Header.Set(
			"Authorization",
			"Bearer "+
				strings.TrimSpace(
					bearerToken,
				),
		)
	}

	response, err :=
		c.httpClient.Do(
			request,
		)

	if err != nil {

		return fmt.Errorf(
			"request failed: %w",
			err,
		)
	}

	defer response.Body.Close()

	responseBody, err :=
		io.ReadAll(
			io.LimitReader(
				response.Body,
				1024*1024,
			),
		)

	if err != nil {

		return fmt.Errorf(
			"could not read response: %w",
			err,
		)
	}

	if response.StatusCode <
		200 ||
		response.StatusCode >=
			300 {

		message :=
			strings.TrimSpace(
				string(
					responseBody,
				),
			)

		if message == "" {

			message =
				response.Status
		}

		return fmt.Errorf(
			"SentinelGrid API returned %s: %s",
			response.Status,
			message,
		)
	}

	if responseTarget ==
		nil {

		return nil
	}

	if len(
		responseBody,
	) == 0 {

		return nil
	}

	if err :=
		json.Unmarshal(
			responseBody,
			responseTarget,
		); err != nil {

		return fmt.Errorf(
			"could not decode response: %w",
			err,
		)
	}

	return nil
}

/* =========================
   POINTER HELPERS
========================= */

func float64Pointer(
	value float64,
) *float64 {

	return &value
}

func uint64Pointer(
	value uint64,
) *uint64 {

	return &value
}