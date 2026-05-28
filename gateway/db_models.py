from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, Float, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


def utc_now():
    return datetime.now(timezone.utc)


class Device(Base):
    __tablename__ = "devices"

    device_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(255))
    organization_name: Mapped[str] = mapped_column(String(255), default="Local Development Tenant")

    hostname: Mapped[str | None] = mapped_column(String(255), nullable=True)
    platform: Mapped[str | None] = mapped_column(String(100), nullable=True)
    agent_version: Mapped[str | None] = mapped_column(String(50), nullable=True)

    api_key: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(50), default="registered")

    first_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    last_metrics: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    remote_address: Mapped[str | None] = mapped_column(String(255), nullable=True)


class EnrollmentToken(Base):
    __tablename__ = "enrollment_tokens"

    token: Mapped[str] = mapped_column(String(255), primary_key=True)
    organization_name: Mapped[str] = mapped_column(String(255), default="Local Development Tenant")
    requested_device_name: Mapped[str] = mapped_column(String(255))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    used: Mapped[bool] = mapped_column(Boolean, default=False)
    used_by_device_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class WebsiteMonitor(Base):
    __tablename__ = "website_monitors"

    website_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    url: Mapped[str] = mapped_column(Text)

    expected_status: Mapped[int] = mapped_column(Integer, default=200)
    check_interval_seconds: Mapped[int] = mapped_column(Integer, default=10)

    status: Mapped[str] = mapped_column(String(50), default="unknown")
    last_checked: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class WebsiteCheckResult(Base):
    __tablename__ = "website_check_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    website_id: Mapped[str] = mapped_column(String(255), index=True)
    name: Mapped[str] = mapped_column(String(255))
    url: Mapped[str] = mapped_column(Text)

    status: Mapped[str] = mapped_column(String(50))
    expected_status: Mapped[int] = mapped_column(Integer)
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)