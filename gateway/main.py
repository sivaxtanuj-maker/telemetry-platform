import json
import os
import secrets
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth_utils import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from database import check_database_connection, get_db, init_database
from db_models import Device, EnrollmentToken, Organization, User, WebsiteMonitor
from kafka_client import KAFKA_BOOTSTRAP_SERVERS, get_kafka_producer


TELEMETRY_TOPIC = "telemetry-stream"
DEV_API_KEY = "dev-api-key"

producer = None
bearer_scheme = HTTPBearer(auto_error=True)


def utc_now():
    return datetime.now(timezone.utc)


def normalize_datetime(value):
    if value is None:
        return None

    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)

    return value


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


async def validate_telemetry_api_key(api_key: Optional[str], db: AsyncSession):
    if not api_key:
        raise HTTPException(status_code=401, detail="Missing API key")

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


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
):
    token = credentials.credentials

    try:
        payload = decode_access_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid auth token")

    user_id = payload.get("sub")

    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid auth token")

    user = await db.get(User, user_id)

    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return user


async def get_current_workspace(user: User = Depends(get_current_user)):
    return {
        "organization_id": user.organization_id,
        "user_id": user.user_id,
        "email": user.email,
        "role": user.role,
    }


def serialize_user(user: User):
    return {
        "user_id": user.user_id,
        "organization_id": user.organization_id,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "last_login_at": user.last_login_at.isoformat()
        if user.last_login_at
        else None,
    }


def serialize_organization(org: Organization):
    if not org:
        return None

    return {
        "organization_id": org.organization_id,
        "name": org.name,
        "plan": org.plan,
        "created_at": org.created_at.isoformat() if org.created_at else None,
    }


def serialize_device(device: Device, include_api_key: bool = False):
    data = {
        "device_id": device.device_id,
        "organization_id": device.organization_id,
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
        "organization_id": site.organization_id,
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


class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str = ""
    organization_name: str = "My Organization"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


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


@asynccontextmanager
async def lifespan(app: FastAPI):
    global producer

    print("Starting gateway...")

    print("Initializing Postgres database...")
    await init_database()
    print("Postgres tables ready.")

    try:
        producer = get_kafka_producer()
        await producer.start()
        print(f"Kafka producer connected at {KAFKA_BOOTSTRAP_SERVERS}")
    except Exception as e:
        producer = None
        print(f"Kafka unavailable. Reason: {e}")

    yield

    if producer is not None:
        await producer.stop()
        print("Kafka producer stopped")


app = FastAPI(lifespan=lifespan)

allowed_origins_raw = os.getenv("CORS_ALLOW_ORIGINS", "*")

if allowed_origins_raw == "*":
    allowed_origins = ["*"]
else:
    allowed_origins = [
        origin.strip()
        for origin in allowed_origins_raw.split(",")
        if origin.strip()
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {
        "service": "aether-gateway",
        "status": "online",
        "health_url": "/health",
    }


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
        "kafka_bootstrap": KAFKA_BOOTSTRAP_SERVERS,
        "device_count": len(devices),
        "website_monitor_count": len(websites),
        "ingest_endpoint": "/api/v1/telemetry",
    }


@app.post("/api/v1/auth/signup")
async def signup(payload: SignupRequest, db: AsyncSession = Depends(get_db)):
    email = payload.email.lower().strip()

    existing_result = await db.execute(
        select(User).where(User.email == email)
    )
    existing_user = existing_result.scalar_one_or_none()

    if existing_user:
        raise HTTPException(status_code=409, detail="Email already registered")

    organization = Organization(
        organization_id="org_" + secrets.token_urlsafe(12),
        name=payload.organization_name.strip() or "My Organization",
        plan="free",
    )

    user = User(
        user_id="user_" + secrets.token_urlsafe(12),
        organization_id=organization.organization_id,
        email=email,
        full_name=payload.full_name.strip() or None,
        password_hash=hash_password(payload.password),
        role="owner",
        last_login_at=utc_now(),
    )

    db.add(organization)
    db.add(user)

    await db.commit()
    await db.refresh(organization)
    await db.refresh(user)

    access_token = create_access_token(
        {
            "sub": user.user_id,
            "organization_id": organization.organization_id,
            "email": user.email,
            "role": user.role,
        }
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": serialize_user(user),
        "organization": serialize_organization(organization),
    }


@app.post("/api/v1/auth/login")
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    email = payload.email.lower().strip()

    result = await db.execute(
        select(User).where(User.email == email)
    )
    user = result.scalar_one_or_none()

    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    user.last_login_at = utc_now()

    await db.commit()
    await db.refresh(user)

    organization = await db.get(Organization, user.organization_id)

    access_token = create_access_token(
        {
            "sub": user.user_id,
            "organization_id": user.organization_id,
            "email": user.email,
            "role": user.role,
        }
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": serialize_user(user),
        "organization": serialize_organization(organization),
    }


@app.get("/api/v1/me")
async def me(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    organization = await db.get(Organization, user.organization_id)

    return {
        "user": serialize_user(user),
        "organization": serialize_organization(organization),
    }


@app.post("/api/v1/websites")
async def create_website_monitor(
    payload: WebsiteCreateRequest,
    db: AsyncSession = Depends(get_db),
    workspace: dict = Depends(get_current_workspace),
):
    website_id = "site_" + secrets.token_urlsafe(8)

    url = payload.url.strip()

    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url

    interval = max(5, int(payload.check_interval_seconds or 10))

    site = WebsiteMonitor(
        website_id=website_id,
        organization_id=workspace["organization_id"],
        name=payload.name.strip() or "Unnamed Monitor",
        url=url,
        expected_status=int(payload.expected_status or 200),
        check_interval_seconds=interval,
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
async def list_website_monitors(
    db: AsyncSession = Depends(get_db),
    workspace: dict = Depends(get_current_workspace),
):
    result = await db.execute(
        select(WebsiteMonitor)
        .where(WebsiteMonitor.organization_id == workspace["organization_id"])
        .order_by(WebsiteMonitor.created_at.desc())
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
    workspace: dict = Depends(get_current_workspace),
):
    site = await db.get(WebsiteMonitor, website_id)

    if not site or site.organization_id != workspace["organization_id"]:
        raise HTTPException(status_code=404, detail="Website monitor not found")

    removed = serialize_website_monitor(site)

    await db.delete(site)
    await db.commit()

    return {
        "status": "deleted",
        "website": removed,
    }


@app.post("/api/v1/devices/enrollment-token")
async def create_enrollment_token(
    payload: EnrollmentTokenRequest,
    db: AsyncSession = Depends(get_db),
    workspace: dict = Depends(get_current_workspace),
):
    token = "enroll_" + secrets.token_urlsafe(24)

    now = utc_now()
    expires_at = now + timedelta(minutes=int(payload.expires_in_minutes or 60))

    organization = await db.get(Organization, workspace["organization_id"])
    organization_name = (
        organization.name
        if organization
        else payload.organization_name or "Local Development Tenant"
    )

    token_record = EnrollmentToken(
        token=token,
        organization_id=workspace["organization_id"],
        organization_name=organization_name,
        requested_device_name=payload.device_name.strip() or "New-Device-Node",
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

    expires_at = normalize_datetime(token_record.expires_at)

    if utc_now() > expires_at:
        raise HTTPException(status_code=401, detail="Enrollment token expired")

    requested_name = token_record.requested_device_name or payload.hostname
    device_id = await make_unique_device_id(requested_name, db)
    api_key = "device_" + secrets.token_urlsafe(32)

    device = Device(
        device_id=device_id,
        organization_id=token_record.organization_id,
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
async def list_devices(
    db: AsyncSession = Depends(get_db),
    workspace: dict = Depends(get_current_workspace),
):
    result = await db.execute(
        select(Device)
        .where(Device.organization_id == workspace["organization_id"])
        .order_by(Device.first_seen.desc())
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
    workspace: dict = Depends(get_current_workspace),
):
    device = await db.get(Device, device_id)

    if not device or device.organization_id != workspace["organization_id"]:
        raise HTTPException(status_code=404, detail="Device not found")

    removed = serialize_device(device)

    await db.delete(device)
    await db.commit()

    return {
        "status": "deleted",
        "device": removed,
    }


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

        data["organization_id"] = device.organization_id

        device.status = "online"
        device.last_seen = utc_now()
        device.last_metrics = data.get("metrics", {})

        await db.commit()

    elif auth_result["mode"] == "dev":
        org_id = "org_dev"
        data["organization_id"] = org_id

        organization = await db.get(Organization, org_id)

        if not organization:
            organization = Organization(
                organization_id=org_id,
                name="Local Development Tenant",
                plan="dev",
            )
            db.add(organization)
            await db.commit()

        device = await db.get(Device, device_id)

        if not device:
            device = Device(
                device_id=device_id,
                organization_id=org_id,
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