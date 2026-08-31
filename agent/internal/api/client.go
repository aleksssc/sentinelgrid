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