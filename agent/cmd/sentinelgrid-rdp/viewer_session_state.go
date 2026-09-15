package main

type viewerSessionState uint8

const (
	viewerStateLaunching viewerSessionState = iota
	viewerStateConnecting
	viewerStateNegotiatingVideo
	viewerStateConnected
	viewerStateDisconnecting
	viewerStateSessionEnded
	viewerStateConnectionLost
)

func (s viewerSessionState) terminal() bool {
	return s == viewerStateSessionEnded || s == viewerStateConnectionLost
}

func (s viewerSessionState) label() string {
	switch s {
	case viewerStateLaunching:
		return "Launching"
	case viewerStateConnecting:
		return "Connecting"
	case viewerStateNegotiatingVideo:
		return "Negotiating video"
	case viewerStateConnected:
		return "Connected"
	case viewerStateDisconnecting:
		return "Disconnecting"
	case viewerStateSessionEnded:
		return "Session ended"
	case viewerStateConnectionLost:
		return "Connection lost"
	default:
		return "Connecting"
	}
}

func viewerTerminalState(localClose bool, closeCategory string) viewerSessionState {
	if localClose {
		return viewerStateDisconnecting
	}
	if closeCategory == "normal" || closeCategory == "going_away" {
		return viewerStateSessionEnded
	}
	return viewerStateConnectionLost
}
