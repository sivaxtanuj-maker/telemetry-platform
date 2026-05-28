import json
import os
import secrets
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from aiokafka import AIOKafkaProducer
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from database import check_database_connection, init_database


KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
TELEMETRY_TOPIC = "telemetry-stream"

DATA_DIR = Path(__file__).parent / "data"
DEVICES_FILE = DATA_DIR / "devices.json"
TOKENS_FILE = DATA_DIR / "enrollment_tokens.json"
WEBSITES_FILE = DATA_DIR / "websites.json"

DEV_API_KEY = "dev-api-key"

producer: Optional[AIOKafkaProducer] = None


# -----------------------------
# Utility helpers
# -----------------------------

def utc_now():
    return datetime.now(timezone.utc)


def utc_now_iso():
    return utc_now().isoformat()


def ensure_data_files():
    DATA_DIR.mkdir(exist_ok=True)

    if not DEVICES_FILE.exists():
        DEVICES_FILE.write_text("{}", encoding="utf-8")

    if not TOKENS_FILE.exists():
        TOKENS_FILE.write_text("{}", encoding="utf-8")
    
    if not WEBSITES_FILE.exists():
        WEBSITES_FILE.write_text("{}", encoding="utf-8")


def read_json(path: Path):
    ensure_data_files()
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def write_json(path: Path, data):
    ensure_data_files()
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def sanitize_device_id(name: str):
    cleaned = "".join(
        ch if ch.isalnum() or ch in ["-", "_"] else "-"
        for ch in name.strip()
    )
    cleaned = "-".join(part for part in cleaned.split("-") if part)
    return cleaned or f"Device-{uuid.uuid4().hex[:8]}"


def make_unique_device_id(requested_name: str):
    devices = read_json(DEVICES_FILE)
    base = sanitize_device_id(requested_name)

    if base not in devices:
        return base

    counter = 2
    while f"{base}-{counter}" in devices:
        counter += 1

    return f"{base}-{counter}"


def find_device_by_api_key(api_key: str):
    devices = read_json(DEVICES_FILE)

    for device_id, device in devices.items():
        if device.get("api_key") == api_key:
            return device_id, device

    return None, None


def get_bearer_token(authorization: Optional[str]):
    if not authorization:
        return None

    parts = authorization.split(" ", 1)

    if len(parts) != 2:
        return None

    scheme, token = parts

    if scheme.lower() != "bearer":
        return None

    return token.strip()


def validate_telemetry_api_key(api_key: Optional[str]):
    if not api_key:
        raise HTTPException(status_code=401, detail="Missing API key")

    # Local dev fallback so your existing dev agent still works.
    if api_key == DEV_API_KEY:
        return {
            "mode": "dev",
            "device_id": None,
            "device": None,
        }

    device_id, device = find_device_by_api_key(api_key)

    if not device:
        raise HTTPException(status_code=401, detail="Invalid device API key")

    return {
        "mode": "device",
        "device_id": device_id,
        "device": device,
    }


async def publish_to_kafka(packet: dict):
    if producer is None:
        raise HTTPException(status_code=503, detail="Kafka producer unavailable")

    await producer.send_and_wait(
        TELEMETRY_TOPIC,
        json.dumps(packet).encode("utf-8"),
    )


# -----------------------------
# Request models
# -----------------------------

class EnrollmentTokenRequest(BaseModel):
    organization_name: str = "Local Development Tenant"
    device_name: str = "New-Device-Node"
    expires_in_minutes: int = 60


class DeviceRegisterRequest(BaseModel):
    enrollment_token: str
    hostname: str
    platform: str
    agent_version: str = "0.1.0"

class WebsiteCreateRequest(BaseModel):
    name: str
    url: str
    expected_status: int = 200
    check_interval_seconds: int = 10


# -----------------------------
# App lifecycle
# -----------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    global producer

    ensure_data_files()

    print("Starting gateway...")

    try:
        print("Initializing Postgres database...")
        await init_database()
        print("Postgres tables ready.")
    except Exception as e:
        print(f"Postgres unavailable during startup. Continuing in JSON fallback mode. Reason: {e}")

    try:
        producer = AIOKafkaProducer(bootstrap_servers=KAFKA_BOOTSTRAP)
        await producer.start()
        print(f"Kafka producer connected at {KAFKA_BOOTSTRAP}")
    except Exception as e:
        producer = None
        print(f"Kafka unavailable. Reason: {e}")

    yield

    if producer is not None:
        await producer.stop()
        print("Kafka producer stopped")


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/v1/websites")
async def create_website_monitor(payload: WebsiteCreateRequest):
    websites = read_json(WEBSITES_FILE)

    website_id = "site_" + secrets.token_urlsafe(8)

    url = payload.url.strip()

    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url

    websites[website_id] = {
        "website_id": website_id,
        "name": payload.name,
        "url": url,
        "expected_status": payload.expected_status,
        "check_interval_seconds": payload.check_interval_seconds,
        "status": "unknown",
        "last_checked": None,
        "last_status_code": None,
        "last_latency_ms": None,
        "last_error": None,
        "created_at": utc_now_iso(),
    }

    write_json(WEBSITES_FILE, websites)

    return {
        "status": "created",
        "website": websites[website_id],
    }


@app.get("/api/v1/websites")
async def list_website_monitors():
    websites = read_json(WEBSITES_FILE)

    return {
        "count": len(websites),
        "websites": list(websites.values()),
    }


@app.delete("/api/v1/websites/{website_id}")
async def delete_website_monitor(website_id: str):
    websites = read_json(WEBSITES_FILE)

    if website_id not in websites:
        raise HTTPException(status_code=404, detail="Website monitor not found")

    removed = websites.pop(website_id)

    write_json(WEBSITES_FILE, websites)

    return {
        "status": "deleted",
        "website": removed,
    }










# -----------------------------
# Health endpoint
# -----------------------------

@app.get("/health")
async def health():
    db_connected = await check_database_connection()

    return {
        "status": "gateway-online",
        "service": "aether-gateway",
        "kafka_enabled": producer is not None,
        "database_connected": db_connected,
        "kafka_bootstrap": KAFKA_BOOTSTRAP,
        "device_count": len(read_json(DEVICES_FILE)),
        "ingest_endpoint": "/api/v1/telemetry",
    }


# -----------------------------
# Device enrollment endpoints
# -----------------------------

@app.post("/api/v1/devices/enrollment-token")
async def create_enrollment_token(payload: EnrollmentTokenRequest):
    tokens = read_json(TOKENS_FILE)

    token = "enroll_" + secrets.token_urlsafe(24)
    now = utc_now()
    expires_at = now + timedelta(minutes=payload.expires_in_minutes)

    tokens[token] = {
        "token": token,
        "organization_name": payload.organization_name,
        "requested_device_name": payload.device_name,
        "created_at": now.isoformat(),
        "expires_at": expires_at.isoformat(),
        "used": False,
    }

    write_json(TOKENS_FILE, tokens)

    return {
        "enrollment_token": token,
        "organization_name": payload.organization_name,
        "device_name": payload.device_name,
        "expires_at": expires_at.isoformat(),
        "register_endpoint": "/api/v1/devices/register",
        "local_gateway_url": "http://localhost:8000/api/v1/telemetry",
        "lan_gateway_url_template": "http://YOUR_WINDOWS_IP:8000/api/v1/telemetry",
    }


@app.post("/api/v1/devices/register")
async def register_device(payload: DeviceRegisterRequest, request: Request):
    tokens = read_json(TOKENS_FILE)
    devices = read_json(DEVICES_FILE)

    token_record = tokens.get(payload.enrollment_token)

    if not token_record:
        raise HTTPException(status_code=401, detail="Invalid enrollment token")

    if token_record.get("used"):
        raise HTTPException(status_code=401, detail="Enrollment token already used")

    expires_at = datetime.fromisoformat(token_record["expires_at"])

    if utc_now() > expires_at:
        raise HTTPException(status_code=401, detail="Enrollment token expired")

    requested_name = token_record.get("requested_device_name") or payload.hostname
    device_id = make_unique_device_id(requested_name)
    api_key = "device_" + secrets.token_urlsafe(32)

    device = {
        "device_id": device_id,
        "display_name": requested_name,
        "organization_name": token_record["organization_name"],
        "hostname": payload.hostname,
        "platform": payload.platform,
        "agent_version": payload.agent_version,
        "api_key": api_key,
        "status": "registered",
        "first_seen": utc_now_iso(),
        "last_seen": None,
        "last_metrics": None,
        "remote_address": request.client.host if request.client else None,
    }

    devices[device_id] = device

    token_record["used"] = True
    token_record["used_by_device_id"] = device_id
    token_record["used_at"] = utc_now_iso()

    tokens[payload.enrollment_token] = token_record

    write_json(DEVICES_FILE, devices)
    write_json(TOKENS_FILE, tokens)

    return {
        "status": "registered",
        "device_id": device_id,
        "device_api_key": api_key,
        "organization_name": device["organization_name"],
        "gateway_url": "http://localhost:8000/api/v1/telemetry",
        "config": {
            "gateway_url": "http://localhost:8000/api/v1/telemetry",
            "device_id": device_id,
            "organization_name": device["organization_name"],
            "api_key": api_key,
            "tick_rate": 2.0,
        },
    }


@app.get("/api/v1/devices")
async def list_devices():
    devices = read_json(DEVICES_FILE)

    safe_devices = []

    for device_id, device in devices.items():
        cleaned = dict(device)
        cleaned.pop("api_key", None)
        safe_devices.append(cleaned)

    return {
        "count": len(safe_devices),
        "devices": safe_devices,
    }

@app.delete("/api/v1/devices/{device_id}")
async def delete_device(device_id: str):
    devices = read_json(DEVICES_FILE)

    if device_id not in devices:
        raise HTTPException(status_code=404, detail="Device not found")

    removed = devices.pop(device_id)

    write_json(DEVICES_FILE, devices)

    safe_removed = dict(removed)
    safe_removed.pop("api_key", None)

    return {
        "status": "deleted",
        "device": safe_removed,
    }

# -----------------------------
# Telemetry ingest endpoint
# -----------------------------

@app.post("/api/v1/telemetry")
async def receive_telemetry(
    data: dict,
    authorization: Optional[str] = Header(default=None),
):
    api_key = get_bearer_token(authorization)
    auth_result = validate_telemetry_api_key(api_key)

    device_id = data.get("device_id", "unknown-device")

    devices = read_json(DEVICES_FILE)

    if auth_result["mode"] == "device":
        registered_device_id = auth_result["device_id"]

        if device_id != registered_device_id:
            data["original_device_id"] = device_id
            data["device_id"] = registered_device_id
            device_id = registered_device_id

        if registered_device_id in devices:
            devices[registered_device_id]["status"] = "online"
            devices[registered_device_id]["last_seen"] = utc_now_iso()
            devices[registered_device_id]["last_metrics"] = data.get("metrics", {})
            write_json(DEVICES_FILE, devices)

    elif auth_result["mode"] == "dev":
        if device_id not in devices:
            devices[device_id] = {
                "device_id": device_id,
                "display_name": device_id,
                "organization_name": data.get("organization_name", "Local Development Tenant"),
                "hostname": device_id,
                "platform": "dev",
                "agent_version": "dev",
                "api_key": DEV_API_KEY,
                "status": "online",
                "first_seen": utc_now_iso(),
                "last_seen": utc_now_iso(),
                "last_metrics": data.get("metrics", {}),
                "remote_address": None,
            }
        else:
            devices[device_id]["status"] = "online"
            devices[device_id]["last_seen"] = utc_now_iso()
            devices[device_id]["last_metrics"] = data.get("metrics", {})

        write_json(DEVICES_FILE, devices)

    print(f"Telemetry accepted from device: {device_id}")

    await publish_to_kafka(data)

    print(f"Telemetry published to Kafka topic {TELEMETRY_TOPIC}: {device_id}")

    return {
        "status": "published",
        "device_id": device_id,
        "topic": TELEMETRY_TOPIC,
    }