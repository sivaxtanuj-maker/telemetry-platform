#!/usr/bin/env bash

set -e

echo "Starting AETHER Linux Agent..."

cd "$(dirname "$0")"

if [ ! -d "$HOME/aether-env" ]; then
  echo "Virtual environment not found at ~/aether-env"
  echo "Create it with:"
  echo "python3 -m venv ~/aether-env"
  echo "source ~/aether-env/bin/activate"
  echo "python -m pip install httpx psutil"
  exit 1
fi

source "$HOME/aether-env/bin/activate"

export AETHER_GATEWAY_URL="http://$(ip route | awk '/default/ {print $3}'):8000/api/v1/telemetry"
export AETHER_DEVICE_ID="${AETHER_DEVICE_ID:-Ubuntu-Server-Node01}"
export AETHER_ORG_NAME="${AETHER_ORG_NAME:-Linux Infrastructure Cluster}"

python agent.py
