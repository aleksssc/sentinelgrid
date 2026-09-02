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
)

type Client struct {
	BaseURL    string
	HTTPClient *http.Client
}

type EnrollmentRequest struct {
	Token string `json:"token"`

	Hostname   string `json:"hostname"`
	OS         string `json:"os"`
	Arch       string `json:"arch"`
	LocalIP    string `json:"local_ip"`
	MACAddress string `json:"mac_address"`
}

type EnrollmentResponse struct {
	DeviceID   string `json:"device_id"`
	AgentID    string `json:"agent_id"`
	AgentToken string `json:"agent_token"`
}

type HeartbeatResponse struct {
	OK bool `json:"ok"`

	DeviceID string `json:"device_id"`

	Hostname string `json:"hostname"`

	Status string `json:"status"`

	LastSeen string `json:"last_seen"`
}

func NewClient(baseURL string) *Client {
	return &Client{
		BaseURL: strings.TrimRight(
			baseURL,
			"/",
		),

		HTTPClient: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

func (c *Client) Enroll(
	token string,
	systemInventory *inventory.Inventory,
) (*EnrollmentResponse, error) {
	requestBody := EnrollmentRequest{
		Token: token,

		Hostname:   systemInventory.Hostname,
		OS:         systemInventory.OS,
		Arch:       systemInventory.Arch,
		LocalIP:    systemInventory.LocalIP,
		MACAddress: systemInventory.MACAddress,
	}

	body, err := json.Marshal(
		requestBody,
	)

	if err != nil {
		return nil, err
	}

	url :=
		c.BaseURL +
			"/api/agent/enroll"

	request, err :=
		http.NewRequest(
			http.MethodPost,
			url,
			bytes.NewBuffer(body),
		)

	if err != nil {
		return nil, err
	}

	request.Header.Set(
		"Content-Type",
		"application/json",
	)

	response, err :=
		c.HTTPClient.Do(
			request,
		)

	if err != nil {
		return nil, err
	}

	defer response.Body.Close()

	responseBody, err :=
		io.ReadAll(
			response.Body,
		)

	if err != nil {
		return nil, err
	}

	if response.StatusCode <
		200 ||
		response.StatusCode >=
			300 {
		return nil, fmt.Errorf(
			"server returned %s: %s",
			response.Status,
			string(responseBody),
		)
	}

	var enrollmentResponse EnrollmentResponse

	err =
		json.Unmarshal(
			responseBody,
			&enrollmentResponse,
		)

	if err != nil {
		return nil, err
	}

	return &enrollmentResponse, nil
}

func (c *Client) Heartbeat(
	agentToken string,
) (*HeartbeatResponse, error) {

	req, err :=
		http.NewRequest(
			http.MethodPost,
			c.BaseURL+
				"/api/agent/heartbeat",
			nil,
		)

	if err != nil {
		return nil,
			fmt.Errorf(
				"could not create heartbeat request: %w",
				err,
			)
	}

	req.Header.Set(
		"Authorization",
		"Bearer "+agentToken,
	)

	req.Header.Set(
		"Accept",
		"application/json",
	)

	response, err :=
		c.HTTPClient.Do(req)

	if err != nil {
		return nil,
			fmt.Errorf(
				"heartbeat request failed: %w",
				err,
			)
	}

	defer response.Body.Close()

	body, err :=
		io.ReadAll(
			response.Body,
		)

	if err != nil {
		return nil,
			fmt.Errorf(
				"could not read heartbeat response: %w",
				err,
			)
	}

	if response.StatusCode <
		200 ||
		response.StatusCode >=
			300 {

		return nil,
			fmt.Errorf(
				"heartbeat failed with HTTP %d: %s",
				response.StatusCode,
				string(body),
			)
	}

	var result HeartbeatResponse

	if err :=
		json.Unmarshal(
			body,
			&result,
		); err != nil {

		return nil,
			fmt.Errorf(
				"could not decode heartbeat response: %w",
				err,
			)
	}

	return &result, nil
}