#!/usr/bin/env bash

set -e

ENROLLMENT_TOKEN=""
GATEWAY_URL="http://localhost:8000"
INSTALL_DIR="$HOME/.aether-agent"
AGENT_SOURCE_URL="https://raw.githubusercontent.com/sivaxtanuj-maker/telemetry-platform/main/agent/agent.py"
USE_LOCAL_SOURCE="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --token)
      ENROLLMENT_TOKEN="$2"
      shift 2
      ;;
    --gateway-url)
      GATEWAY_URL="$2"
      shift 2
      ;;
    --install-dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --use-local-source)
      USE_LOCAL_SOURCE="true"
      shift
      ;;
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

if [[ -z "$ENROLLMENT_TOKEN" ]]; then
  echo "Missing required --token argument"
  exit 1
fi

if [[ "$GATEWAY_URL" != */api/v1/telemetry ]]; then
  GATEWAY_URL="${GATEWAY_URL%/}/api/v1/telemetry"
fi

echo "=========================================="
echo "AETHER Linux Agent Installer"
echo "=========================================="
echo "Gateway URL: $GATEWAY_URL"
echo "Install Dir: $INSTALL_DIR"

mkdir -p "$INSTALL_DIR"

AGENT_PATH="$INSTALL_DIR/agent.py"
VENV_PATH="$INSTALL_DIR/venv"
RUN_SCRIPT_PATH="$INSTALL_DIR/run_agent.sh"

if [[ "$USE_LOCAL_SOURCE" == "true" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  LOCAL_AGENT_PATH="$SCRIPT_DIR/../agent/agent.py"
  echo "Copying local agent from $LOCAL_AGENT_PATH"
  cp "$LOCAL_AGENT_PATH" "$AGENT_PATH"
else
  echo "Downloading agent from GitHub..."
  curl -fsSL "$AGENT_SOURCE_URL" -o "$AGENT_PATH"
fi

if [[ ! -d "$VENV_PATH" ]]; then
  echo "Creating Python virtual environment..."
  python3 -m venv "$VENV_PATH"
fi

source "$VENV_PATH/bin/activate"

echo "Installing Python dependencies..."
python -m pip install --upgrade pip
python -m pip install httpx psutil

cat > "$RUN_SCRIPT_PATH" <<EOF
#!/usr/bin/env bash
set -e
cd "$INSTALL_DIR"
source "$VENV_PATH/bin/activate"
python "$AGENT_PATH"
EOF

chmod +x "$RUN_SCRIPT_PATH"

echo "Registering device using enrollment token..."

export AETHER_ENROLLMENT_TOKEN="$ENROLLMENT_TOKEN"
export AETHER_GATEWAY_URL="$GATEWAY_URL"

python "$AGENT_PATH"
