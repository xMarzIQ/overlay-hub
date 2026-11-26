#!/bin/bash
# PC mode on a Mac: runs the overlay hub on this computer, as a free backup if the online server ever has a problem.
# Double-click this file. It needs Node.js 18 or newer from https://nodejs.org
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then echo "Node.js isn't installed. Get it from https://nodejs.org, then double-click this again."; read -r; exit 1; fi
[ -d node_modules ] || { echo "Installing, this happens once..."; npm ci --omit=dev --no-audit --no-fund; }
read -r -p "Type a control key (password) for the hub, then press Enter: " CONTROL_KEY
export CONTROL_KEY PORT=8080
echo
echo "In OBS, use: http://localhost:8080/overlay  (or the streamer's own link from the hub)"
echo "On your phone (same Wi-Fi), open one of the 'On your network' links below."
echo "To load your setup: Settings, Backup, Restore from a file."
echo
(sleep 2; open "http://localhost:8080/control") &
node server.js
