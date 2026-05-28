# AETHER Telemetry Platform

AETHER is a real-time infrastructure telemetry and anomaly detection platform. It simulates how enterprise observability tools monitor distributed machines, stream system metrics through a data pipeline, and display live node health inside a web dashboard.

The system collects CPU, memory, disk, network, and anomaly-score metrics from multiple devices, sends them through a FastAPI ingestion gateway, publishes events into Kafka, streams live updates over WebSockets, and visualizes everything in a React dashboard.

## Project Status

This project currently supports:

* Windows telemetry agent
* Linux/Ubuntu telemetry agent
* FastAPI ingestion gateway
* Kafka event streaming
* WebSocket live streamer
* React dashboard
* Live device status tracking
* CPU, memory, disk, network, and anomaly metrics
* Cross-platform launcher scripts

## Architecture

```txt
Windows Agent
Linux Agent
     |
     v
FastAPI Gateway
     |
     v
Kafka telemetry-stream / alerts-stream
     |
     v
Processor + WebSocket Streamer
     |
     v
React Dashboard
```

## Tech Stack

### Backend

* Python
* FastAPI
* Uvicorn
* Kafka
* aiokafka
* httpx
* psutil
* WebSockets

### Frontend

* React
* Vite
* Recharts
* Lucide React
* CSS

### Infrastructure

* Docker
* Docker Compose
* Git/GitHub
* Windows PowerShell
* Ubuntu/WSL

## Main Features

### Real-Time Telemetry Agents

The agents collect live machine metrics such as:

* CPU usage
* Memory usage
* Disk usage
* Network bytes sent/received
* Network packets sent/received
* Anomaly score
* Device identity
* Operating system information

### FastAPI Gateway

The gateway receives telemetry over HTTP and publishes the data into Kafka.

Endpoint:

```txt
POST /api/v1/telemetry
```

### Kafka Streaming Layer

Kafka is used as the event backbone of the system.

Topics:

```txt
telemetry-stream
alerts-stream
```

### WebSocket Streamer

The streamer consumes Kafka messages and pushes live updates to the React dashboard through WebSockets.

Default WebSocket URL:

```txt
ws://localhost:8765
```

### React Dashboard

The dashboard displays:

* Global fleet health
* Average cluster CPU
* Cluster memory usage
* Ingest throughput
* Active SLA alerts
* Active infrastructure nodes
* Real-time waveform charts
* Node connection status

## Local Development Setup

### 1. Start Kafka

```powershell
cd C:\Users\Tanuj\telemetry-platform
docker compose up
```

### 2. Start the FastAPI Gateway

Open a new PowerShell terminal:

```powershell
cd C:\Users\Tanuj\telemetry-platform\gateway
..\.venv\Scripts\Activate.ps1
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### 3. Start the WebSocket Streamer

Open another PowerShell terminal:

```powershell
cd C:\Users\Tanuj\telemetry-platform\processor
..\.venv\Scripts\Activate.ps1
python streamer.py
```

### 4. Start the Frontend

Open another PowerShell terminal:

```powershell
cd C:\Users\Tanuj\telemetry-platform\frontend
npm run dev
```

Then open the Vite URL shown in the terminal.

Usually:

```txt
http://localhost:5173
```

or:

```txt
http://localhost:5174
```

### 5. Start the Windows Agent

```powershell
cd C:\Users\Tanuj\telemetry-platform\agent
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
.\run_windows_agent.ps1
```

### 6. Start the Linux Agent from WSL

```bash
cd /mnt/c/Users/Tanuj/telemetry-platform/agent
./run_linux_agent.sh
```

## Agent Configuration

The agent supports a local config file:

```txt
agent/agent_config.json
```

Example:

```json
{
  "gateway_url": "http://localhost:8000/api/v1/telemetry",
  "device_id": "Windows-Workstation-Node01",
  "organization_name": "Local Development Tenant",
  "api_key": "dev-api-key",
  "tick_rate": 2.0
}
```

A safe example file is included:

```txt
agent/agent_config.example.json
```

The real config file is ignored by Git.

## Example Data Flow

```txt
1. Agent collects system metrics.
2. Agent sends telemetry to FastAPI.
3. FastAPI publishes telemetry to Kafka.
4. Streamer consumes Kafka messages.
5. Streamer pushes updates to dashboard over WebSocket.
6. Dashboard updates live charts and node cards.
```

## Future Improvements

Planned upgrades:

* Device enrollment tokens
* Add Device button in dashboard
* User authentication
* Organization/tenant accounts
* Persistent database storage
* Historical metrics view
* Alert rules engine
* Email/SMS/Discord alert delivery
* Dockerized backend services
* Production deployment
* TLS-secured WebSocket support
* API key validation
* Mobile companion app or QR-based device pairing

## Why This Project Matters

This project demonstrates skills in:

* Distributed systems
* Real-time data pipelines
* Backend API development
* Kafka event streaming
* WebSocket communication
* Systems monitoring
* Frontend dashboard design
* Cross-platform agent development
* Docker-based local infrastructure

It is designed to resemble the foundations of an enterprise observability platform like Datadog, New Relic, or Grafana Cloud.
