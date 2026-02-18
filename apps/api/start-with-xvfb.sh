#!/bin/bash
cd "$(dirname "$0")"
exec xvfb-run -a node src/server.js
