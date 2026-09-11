//go:build !windows

package main

import "log"

func main() { log.Fatal("SentinelGridUpdater requires Windows") }
