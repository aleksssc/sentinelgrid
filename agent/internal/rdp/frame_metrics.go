package rdp

import (
	"sort"
	"sync"
	"time"
)

// frameMetrics keeps a bounded sample window for periodic diagnostics. It is
// deliberately independent from logging so instrumentation cannot affect I/O.
type frameMetrics struct {
	mu      sync.Mutex
	values  []time.Duration
	maximum int
}

type frameMetricSnapshot struct {
	Count int
	Avg   time.Duration
	P50   time.Duration
	P95   time.Duration
	Max   time.Duration
}

func newFrameMetrics(maximum int) *frameMetrics {
	return &frameMetrics{maximum: maximum}
}

func (m *frameMetrics) add(value time.Duration) {
	if m == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.values) == m.maximum {
		copy(m.values, m.values[1:])
		m.values[len(m.values)-1] = value
		return
	}
	m.values = append(m.values, value)
}

func (m *frameMetrics) snapshot() frameMetricSnapshot {
	if m == nil {
		return frameMetricSnapshot{}
	}
	m.mu.Lock()
	values := append([]time.Duration(nil), m.values...)
	m.mu.Unlock()
	if len(values) == 0 {
		return frameMetricSnapshot{}
	}
	sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
	var total time.Duration
	for _, value := range values {
		total += value
	}
	percentile := func(p float64) time.Duration {
		index := int(float64(len(values)-1)*p + 0.5)
		return values[index]
	}
	return frameMetricSnapshot{Count: len(values), Avg: total / time.Duration(len(values)), P50: percentile(.50), P95: percentile(.95), Max: values[len(values)-1]}
}
