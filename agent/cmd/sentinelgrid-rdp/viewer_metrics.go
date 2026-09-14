package main

import (
	"sort"
	"time"
)

type durationSnapshot struct {
	count int
	avg   time.Duration
	p50   time.Duration
	p95   time.Duration
	max   time.Duration
}

type durationWindow struct {
	values []time.Duration
	limit  int
}

func newDurationWindow(limit int) durationWindow { return durationWindow{limit: limit} }

func (w *durationWindow) add(value time.Duration) {
	if len(w.values) == w.limit {
		copy(w.values, w.values[1:])
		w.values[len(w.values)-1] = value
		return
	}
	w.values = append(w.values, value)
}

func (w *durationWindow) snapshot() durationSnapshot {
	if len(w.values) == 0 {
		return durationSnapshot{}
	}
	values := append([]time.Duration(nil), w.values...)
	sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
	var total time.Duration
	for _, value := range values {
		total += value
	}
	percentile := func(p float64) time.Duration { return values[int(float64(len(values)-1)*p+0.5)] }
	return durationSnapshot{len(values), total / time.Duration(len(values)), percentile(.50), percentile(.95), values[len(values)-1]}
}

func milliseconds(snapshot durationSnapshot) (float64, float64, float64, float64) {
	return float64(snapshot.avg.Microseconds()) / 1000, float64(snapshot.p50.Microseconds()) / 1000, float64(snapshot.p95.Microseconds()) / 1000, float64(snapshot.max.Microseconds()) / 1000
}
