#!/bin/bash
air --build.cmd "go build -o ./tmp/main.exe ./cmd/app" --build.entrypoint "./tmp/main.exe"
