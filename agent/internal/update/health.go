package update

import "time"

type Health struct {
	Version        string    `json:"version"`
	PID            uint32    `json:"pid"`
	ProcessStarted uint64    `json:"process_started"`
	TransactionID  string    `json:"transaction_id"`
	At             time.Time `json:"at"`
}

func healthMatches(h Health, version, transaction string, pid uint32, processStarted uint64, after, runningSince, now time.Time) bool {
	return transaction != "" && h.TransactionID == transaction && h.Version == version &&
		pid != 0 && h.PID == pid && processStarted != 0 && h.ProcessStarted == processStarted &&
		h.At.After(after) && !h.At.After(now.Add(5*time.Second)) && now.Sub(h.At) <= 90*time.Second &&
		now.Sub(runningSince) >= time.Minute
}
