import json
import os
import secrets
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional

from aiokafka import AIOKafkaProducer
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import check_database_connection, get_db, init_database
from db_models import Device, EnrollmentToken, WebsiteMonitor


KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
TELEMETRY_TOPIC = "telemetry-stream"

DEV_API_KEY = "dev-api-key"

producer: Optional[AIOKafkaProducer] = None


# -----------------------------
# Utility helpers
# -----------------------------

def utc_now():
    return datetime.now(timezone.utc)


def utc_now_iso():
    return utc_now().isoformat()


def sanitize_device_id(name: str):
    cleaned = "".join(
        ch if ch.isalnum() or ch in ["-", "_"] else "-"
        for ch in name.strip()
    )
    cleaned = "-".join(part for part in cleaned.split("-") if part)
    return cleaned or f"Device-{uuid.uuid4().hex[:8]}"


async def make_unique_device_id(requested_name: str, db: AsyncSession):
    base = sanitize_device_id(requested_name)

    existing = await db.get(Device, base)

    if not existing:
        return base

    counter = 2

    while True:
        candidate = f"{base}-{counter}"
        existing = await db.get(Device, candidate)

        if not existing:
            return candidate

        counter += 1


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


async def find_device_by_api_key(api_key: str, db: AsyncSession):
    result = await db.execute(
        select(Device).where(Device.api_key == api_key)
    )

    return result.scalar_one_or_none()


async def validate_telemetry_api_key(
    api_key: Optional[str],
    db: AsyncSession,
):
    if not api_key:
        raise HTTPException(status_code=401, detail="Missing API key")

    # Local dev fallback.
    # This lets your old local dev agents keep working.
    if api_key == DEV_API_KEY:
        return {
            "mode": "dev",
            "device": None,
        }

    device = await find_device_by_api_key(api_key, db)

    if not device:
        raise HTTPException(status_code=401, detail="Invalid device API key")

    return {
        "mode": "device",
        "device": device,
    }


async def publish_to_kafka(packet: dict):
    if producer is None:
        raise HTTPException(status_code=503, detail="Kafka producer unavailable")

    await producer.send_and_wait(
        TELEMETRY_TOPIC,
        json.dumps(packet).encode("utf-8"),
    )


def serialize_device(device: Device, include_api_key: bool = False):
    data = {
        "device_id": device.device_id,
        "display_name": device.display_name,
        "organization_name": device.organization_name,
        "hostname": device.hostname,
        "platform": device.platform,
        "agent_version": device.agent_version,
        "status": device.status,
        "first_seen": device.first_seen.isoformat() if device.first_seen else None,
        "last_seen": device.last_seen.isoformat() if device.last_seen else None,
        "last_metrics": device.last_metrics,
        "remote_address": device.remote_address,
    }

    if include_api_key:
        data["api_key"] = device.api_key

    return data


def serialize_website_monitor(site: WebsiteMonitor):
    return {
        "website_id": site.website_id,
        "name": site.name,
        "url": site.url,
        "expected_status": site.expected_status,
        "check_interval_seconds": site.check_interval_seconds,
        "status": site.status,
        "last_checked": site.last_checked.isoformat() if site.last_checked else None,
        "last_status_code": site.last_status_code,
        "last_latency_ms": site.last_latency_ms,
        "last_error": site.last_error,
        "created_at": site.created_at.isoformat() if site.created_at else None,
    }


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

    print("Starting gateway...")

    try:
        print("Initializing Postgres database...")
        await init_database()
        print("Postgres tables ready.")
    except Exception as e:
        print(
            "Postgres unavailable during startup. "
            f"Reason: {e}"
        )
        raise

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


# -----------------------------
# Health endpoint
# -----------------------------

@app.get("/health")
async def health(db: AsyncSession = Depends(get_db)):
    db_connected = await check_database_connection()

    devices_result = await db.execute(select(Device))
    devices = devices_result.scalars().all()

    websites_result = await db.execute(select(WebsiteMonitor))
    websites = websites_result.scalars().all()

    return {
        "status": "gateway-online",
        "service": "aether-gateway",
        "kafka_enabled": producer is not None,
        "database_connected": db_connected,
        "kafka_bootstrap": KAFKA_BOOTSTRAP,
        "device_count": len(devices),
        "website_monitor_count": len(websites),
        "ingest_endpoint": "/api/v1/telemetry",
    }


# -----------------------------
# Website monitor endpoints
# -----------------------------

@app.post("/api/v1/websites")
async def create_website_monitor(
    payload: WebsiteCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    website_id = "site_" + secrets.token_urlsafe(8)

    url = payload.url.strip()

    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url

    site = WebsiteMonitor(
        website_id=website_id,
        name=payload.name,
        url=url,
        expected_status=payload.expected_status,
        check_interval_seconds=payload.check_interval_seconds,
        status="unknown",
        last_checked=None,
        last_status_code=None,
        last_latency_ms=None,
        last_error=None,
    )

    db.add(site)
    await db.commit()
    await db.refresh(site)

    return {
        "status": "created",
        "website": serialize_website_monitor(site),
    }


@app.get("/api/v1/websites")
async def list_website_monitors(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(WebsiteMonitor).order_by(WebsiteMonitor.created_at.desc())
    )

    websites = result.scalars().all()

    return {
        "count": len(websites),
        "websites": [serialize_website_monitor(site) for site in websites],
    }


@app.delete("/api/v1/websites/{website_id}")
async def delete_website_monitor(
    website_id: str,
    db: AsyncSession = Depends(get_db),
):
    site = await db.get(WebsiteMonitor, website_id)

    if not site:
        raise HTTPException(status_code=404, detail="Website monitor not found")

    removed = serialize_website_monitor(site)

    await db.delete(site)
    await db.commit()

    return {
        "status": "deleted",
        "website": removed,
    }


# -----------------------------
# Device enrollment endpoints
# -----------------------------

@app.post("/api/v1/devices/enrollment-token")
async def create_enrollment_token(
    payload: EnrollmentTokenRequest,
    db: AsyncSession = Depends(get_db),
):
    token = "enroll_" + secrets.token_urlsafe(24)
    now = utc_now()
    expires_at = now + timedelta(minutes=payload.expires_in_minutes)

    token_record = EnrollmentToken(
        token=token,
        organization_name=payload.organization_name,
        requested_device_name=payload.device_name,
        created_at=now,
        expires_at=expires_at,
        used=False,
        used_by_device_id=None,
        used_at=None,
    )

    db.add(token_record)
    await db.commit()
    await db.refresh(token_record)

    return {
        "enrollment_token": token_record.token,
        "organization_name": token_record.organization_name,
        "device_name": token_record.requested_device_name,
        "expires_at": token_record.expires_at.isoformat(),
        "register_endpoint": "/api/v1/devices/register",
        "local_gateway_url": "http://localhost:8000/api/v1/telemetry",
        "lan_gateway_url_template": "http://YOUR_WINDOWS_IP:8000/api/v1/telemetry",
    }


@app.post("/api/v1/devices/register")
async def register_device(
    payload: DeviceRegisterRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    token_record = await db.get(EnrollmentToken, payload.enrollment_token)

    if not token_record:
        raise HTTPException(status_code=401, detail="Invalid enrollment token")

    if token_record.used:
        raise HTTPException(status_code=401, detail="Enrollment token already used")

    if utc_now() > token_record.expires_at:
        raise HTTPException(status_code=401, detail="Enrollment token expired")

    requested_name = token_record.requested_device_name or payload.hostname
    device_id = await make_unique_device_id(requested_name, db)
    api_key = "device_" + secrets.token_urlsafe(32)

    device = Device(
        device_id=device_id,
        display_name=requested_name,
        organization_name=token_record.organization_name,
        hostname=payload.hostname,
        platform=payload.platform,
        agent_version=payload.agent_version,
        api_key=api_key,
        status="registered",
        first_seen=utc_now(),
        last_seen=None,
        last_metrics=None,
        remote_address=request.client.host if request.client else None,
    )

    token_record.used = True
    token_record.used_by_device_id = device_id
    token_record.used_at = utc_now()

    db.add(device)
    await db.commit()
    await db.refresh(device)

    return {
        "status": "registered",
        "device_id": device.device_id,
        "device_api_key": device.api_key,
        "organization_name": device.organization_name,
        "gateway_url": "http://localhost:8000/api/v1/telemetry",
        "config": {
            "gateway_url": "http://localhost:8000/api/v1/telemetry",
            "device_id": device.device_id,
            "organization_name": device.organization_name,
            "api_key": device.api_key,
            "tick_rate": 2.0,
        },
    }


@app.get("/api/v1/devices")
async def list_devices(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Device).order_by(Device.first_seen.desc())
    )

    devices = result.scalars().all()

    return {
        "count": len(devices),
        "devices": [serialize_device(device) for device in devices],
    }


@app.delete("/api/v1/devices/{device_id}")
async def delete_device(
    device_id: str,
    db: AsyncSession = Depends(get_db),
):
    device = await db.get(Device, device_id)

    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    removed = serialize_device(device)

    await db.delete(device)
    await db.commit()

    return {
        "status": "deleted",
        "device": removed,
    }


# -----------------------------
# Telemetry ingest endpoint
# -----------------------------

@app.post("/api/v1/telemetry")
async def receive_telemetry(
    data: dict,
    authorization: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    api_key = get_bearer_token(authorization)
    auth_result = await validate_telemetry_api_key(api_key, db)

    device_id = data.get("device_id", "unknown-device")

    if auth_result["mode"] == "device":
        device = auth_result["device"]

        if device_id != device.device_id:
            data["original_device_id"] = device_id
            data["device_id"] = device.device_id
            device_id = device.device_id

        device.status = "online"
        device.last_seen = utc_now()
        device.last_metrics = data.get("metrics", {})

        await db.commit()

    elif auth_result["mode"] == "dev":
        device = await db.get(Device, device_id)

        if not device:
            device = Device(
                device_id=device_id,
                display_name=device_id,
                organization_name=data.get(
                    "organization_name",
                    "Local Development Tenant",
                ),
                hostname=device_id,
                platform="dev",
                agent_version="dev",
                api_key="dev_" + secrets.token_urlsafe(24),
                status="online",
                first_seen=utc_now(),
                last_seen=utc_now(),
                last_metrics=data.get("metrics", {}),
                remote_address=None,
            )

            db.add(device)

        else:
            device.status = "online"
            device.last_seen = utc_now()
            device.last_metrics = data.get("metrics", {})

        await db.commit()

    print(f"Telemetry accepted from device: {device_id}")

    await publish_to_kafka(data)

    print(f"Telemetry published to Kafka topic {TELEMETRY_TOPIC}: {device_id}")

    return {
        "status": "published",
        "device_id": device_id,
        "topic": TELEMETRY_TOPIC,
    }