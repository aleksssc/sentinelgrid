//go:build !windows

package main

import "log"

func main() { log.Fatal("The SentinelGrid native RDP connector requires Windows") }
