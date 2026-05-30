# AETHER Cloud

**Real-time observability SaaS platform for website/API monitoring and infrastructure telemetry.**

AETHER Cloud is a full-stack cloud observability platform inspired by tools like Datadog, New Relic, and Grafana Cloud. It allows users to create a workspace, monitor websites and APIs, enroll machines with a lightweight telemetry agent, and view live infrastructure health through a real-time dashboard.

The platform was built as a production-style SaaS system using a React frontend, FastAPI backend, PostgreSQL persistence, Kafka event streaming, WebSocket live updates, and cloud deployment across Netlify, Render, and Aiven.

---
> Note: This demo runs on free-tier infrastructure. The first request may take 30–60 seconds while Render services wake up.
---

## Project Highlights

* Built a full-stack observability SaaS platform with authentication, monitoring, telemetry ingestion, and real-time dashboard updates.
* Designed a multi-service cloud architecture using React, FastAPI, PostgreSQL, Kafka, and WebSockets.
* Implemented JWT-based authentication with workspace-level data isolation.
* Built website/API uptime monitoring with latency tracking and live status updates.
* Built a machine enrollment flow for infrastructure telemetry using secure device API keys.
* Streamed website and device events through Kafka topics and broadcasted updates to the frontend using WebSockets.
* Deployed frontend, backend, database, and streaming infrastructure across Netlify, Render, and Aiven.
* Debugged production deployment issues involving Python versions, dependency resolution, Render environment variables, Kafka SSL certificates, and cloud service configuration.

---

## Tech Stack

### Frontend

* React
* Vite
* JavaScript
* Recharts
* Lucide React
* Browser localStorage
* Netlify deployment

### Backend

* Python
* FastAPI
* SQLAlchemy async ORM
* JWT authentication
* Password hashing
* Async PostgreSQL connection
* Render deployment

### Database

* PostgreSQL
* Render Postgres

### Streaming and Real-Time Infrastructure

* Apache Kafka
* Aiven Kafka
* Kafka event topics
* WebSockets
* `aiohttp`
* `aiokafka`

### Infrastructure / Deployment

* Netlify for frontend hosting
* Render Web Services for backend services
* Render Postgres for relational storage
* Aiven Kafka for managed event streaming
* Environment variables and secret files for production configuration

---

## System Architecture

```txt
User Browser
  |
  | HTTPS
  v
Netlify React Frontend
  |
  | REST API calls
  v
Render FastAPI Gateway
  |
  | SQL queries
  v
Render PostgreSQL Database

Render FastAPI Gateway
  |
  | Kafka events
  v
Aiven Kafka
  |
  | Kafka consumers
  v
Render Streamer Service
  |
  | WebSocket messages
  v
Live React Dashboard
```

The deployed system is split into several services:

```txt
Netlify
  React frontend

Render
  aether-gateway
    FastAPI backend API

Render
  aether-streamer
    WebSocket server
    Kafka consumer
    Embedded website monitor loop

Render
  aether-postgres
    PostgreSQL database

Aiven
  Apache Kafka
    telemetry-stream
    alerts-stream
    website-monitor-stream

User Machine
  Optional Python telemetry agent
```

---

## Core Features

### User Authentication

AETHER includes a complete authentication flow:

* User signup
* User login
* JWT access tokens
* Password hashing
* Protected API routes
* Workspace-based data isolation

Each user belongs to an organization/workspace. Website monitors and devices are tied to that organization, which prevents one user from seeing another user’s data.

---

### Website and API Monitoring

Users can add websites or APIs to monitor.

For each monitor, the system tracks:

* URL
* Expected HTTP status code
* Current status
* Last checked time
* Last response code
* Latency in milliseconds
* Error messages if the check fails

Supported monitor states:

```txt
unknown   monitor has been created but not checked yet
up        endpoint returned the expected status code
degraded  endpoint responded but did not match expected status
down      request failed or timed out
```

---

### Machine Telemetry

AETHER supports machine enrollment through an agent-based telemetry model.

The device flow:

```txt
1. User generates an enrollment token.
2. Agent registers with the backend.
3. Backend creates a device API key.
4. Agent sends telemetry to the gateway.
5. Gateway validates the device key.
6. Metrics are stored and streamed to the dashboard.
```

Telemetry can include:

* CPU usage
* Memory usage
* Device status
* Hostname
* Platform
* Agent version
* Anomaly score

---

### Kafka Event Streaming

Kafka is used as the live event backbone of the system.

Kafka topics:

```txt
telemetry-stream
  Machine telemetry events such as CPU, memory, and anomaly metrics.

website-monitor-stream
  Website/API uptime check results.

alerts-stream
  Reserved for alert and SLA breach events.
```

Kafka allows the system to separate event producers from event consumers. The backend can publish telemetry or website status events without directly depending on connected frontend clients.

---

### WebSocket Live Dashboard

The dashboard receives real-time updates through WebSockets.

Instead of forcing the frontend to refresh repeatedly, the streamer service keeps a live WebSocket connection open and pushes new Kafka events directly to the browser.

This enables live updates for:

* Website status
* Website latency
* Device telemetry
* Alert feed data
* System health indicators

---

## Important API Endpoints

### Health

```txt
GET /health
```

Checks whether the API service is online and connected to Postgres/Kafka.

### Authentication

```txt
POST /api/v1/auth/signup
POST /api/v1/auth/login
GET  /api/v1/me
```

### Website Monitors

```txt
POST   /api/v1/websites
GET    /api/v1/websites
DELETE /api/v1/websites/{website_id}
```

### Devices

```txt
POST   /api/v1/devices/enrollment-token
POST   /api/v1/devices/register
GET    /api/v1/devices
DELETE /api/v1/devices/{device_id}
```

### Telemetry

```txt
POST /api/v1/telemetry
```

Accepts telemetry from enrolled devices and publishes events into Kafka.

---

## Data Flow Examples

### Signup Flow

```txt
User submits signup form
↓
React sends request to FastAPI gateway
↓
Gateway validates input
↓
Gateway hashes password
↓
Gateway creates user and organization in Postgres
↓
Gateway returns JWT access token
↓
Frontend stores token and enters dashboard
```

### Website Monitoring Flow

```txt
User adds website monitor
↓
Gateway stores monitor in Postgres
↓
Streamer reads monitors from Postgres
↓
Streamer checks website status and latency
↓
Streamer updates Postgres with latest result
↓
Streamer publishes result to Kafka
↓
Streamer broadcasts result over WebSocket
↓
React dashboard updates live
```

### Machine Telemetry Flow

```txt
Agent registers with enrollment token
↓
Gateway creates device and API key
↓
Agent sends telemetry to gateway
↓
Gateway validates device API key
↓
Gateway updates latest device metrics in Postgres
↓
Gateway publishes telemetry event to Kafka
↓
Streamer consumes event
↓
Dashboard updates live through WebSocket
```

---

## Production Deployment

The project is deployed using free-tier cloud services:

| Layer              | Service            |
| ------------------ | ------------------ |
| Frontend           | Netlify            |
| Backend API        | Render Web Service |
| Real-time Streamer | Render Web Service |
| Database           | Render Postgres    |
| Kafka              | Aiven Kafka        |

The frontend uses public environment variables:

```env
VITE_GATEWAY_API_BASE=https://aether-gateway-0zag.onrender.com
VITE_WS_URL=wss://aether-streamer.onrender.com/ws
VITE_STREAMER_HEALTH_URL=https://aether-streamer.onrender.com/health
```

Backend secrets are stored only in Render environment variables and secret files.

Sensitive values such as database URLs, JWT secrets, Kafka credentials, and certificates are not committed to GitHub.

---

## Deployment Challenges Solved

During deployment, several production-style issues were debugged and fixed:

### Render Python Version Issue

Render initially used a newer Python version that caused dependency build failures. This was fixed by setting:

```env
PYTHON_VERSION=3.11.10
```

### Missing Backend Dependencies

The backend initially deployed with an incomplete `requirements.txt`. Missing packages such as `aiokafka`, `sqlalchemy`, `asyncpg`, `bcrypt`, and `PyJWT` were added.

### Wrong Git Branch / Old Commit Deployment

Render was deploying an older Git commit from `main`. The feature branch was pushed into `main` so Render could deploy the latest production-ready code.

### Kafka SSL Certificate Verification

Aiven Kafka required SSL certificate verification using its CA certificate. The certificate was added as a Render Secret File and loaded through:

```env
KAFKA_CA_CERT_PATH=/etc/secrets/aiven-ca.pem
```

### Frontend Environment Variable Misconfiguration

The frontend accidentally received a Postgres database URL instead of the FastAPI gateway URL. This caused browser fetch requests to fail. The issue was fixed by setting:

```env
VITE_GATEWAY_API_BASE=https://aether-gateway-0zag.onrender.com
```

This reinforced the rule that frontend environment variables must only contain public URLs, never private secrets.

---

## Security Considerations

The project includes several security practices:

* Passwords are hashed before being stored.
* Users authenticate using JWT access tokens.
* Protected routes require bearer tokens.
* Users are isolated by organization/workspace.
* Device agents use API keys after enrollment.
* Backend secrets are stored in Render environment variables.
* Kafka CA certificates are stored as Render Secret Files.
* Database URLs and private credentials are not intended to be exposed to the frontend.

---

## Free-Tier Notes

This project is currently configured as a portfolio demo using free-tier cloud infrastructure.

Known limitations:

* Render services may sleep after inactivity.
* First request after sleep may take 30–60 seconds.
* Free Postgres databases may expire or reset depending on provider limits.
* Kafka usage should remain low.
* Local telemetry agents should only be run during demos.

For a production version, the database and background workers should be moved to persistent paid infrastructure.

---

## What I Learned

This project helped me learn and practice:

* Full-stack SaaS architecture
* React frontend development
* FastAPI backend development
* JWT authentication
* Password hashing
* PostgreSQL schema design
* Multi-tenant data isolation
* Kafka event streaming
* WebSocket real-time communication
* Cloud deployment with Netlify, Render, and Aiven
* Environment variable configuration
* Secret file management
* Debugging production logs
* Designing agent-based telemetry pipelines

---

## Future Improvements

Planned improvements include:

* Email or Slack downtime alerts
* Incident history pages
* More detailed uptime charts
* Team invitations
* Role-based access control
* Billing and subscription plans
* More advanced anomaly detection
* Dockerized deployment
* Dedicated background workers
* Custom domain
* Demo video and screenshots

---

## Project Status

AETHER Cloud is currently a live portfolio demo.

The platform supports:

* User accounts
* Workspace creation
* Website/API monitoring
* Kafka event streaming
* WebSocket live dashboard updates
* Device enrollment
* Machine telemetry ingestion
* Cloud deployment
