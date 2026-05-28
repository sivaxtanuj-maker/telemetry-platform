import asyncio
import json
import logging
import os
import platform
import random
import socket
import time
from pathlib import Path

import httpx
import psutil


# ============================================================
# AETHER TELEMETRY AGENT
# Sends machine metrics to the FastAPI ingestion gateway.
#
# Data path:
# Agent -> FastAPI Gateway -> Kafka -> Streamer -> React Dashboard
# ============================================================


# ------------------------------------------------------------
# Config loading
# ------------------------------------------------------------

DEFAULT_CONFIG_PATH = Path(__file__).parent / "agent_config.json"

CONFIG_PATH = Path(
    os.getenv("AETHER_AGENT_CONFIG", str(DEFAULT_CONFIG_PATH))
)


def load_config():
    """
    Loads config from agent_config.json.

    Environment variables can override the config file.
    This is useful when running the same code on Windows, Ubuntu, Docker, etc.
    """

    config = {
        "gateway_url": "http://localhost:8000/api/v1/telemetry",
        "device_id": f"{platform.system()}-{socket.gethostname()}",
        "organization_name": "Local Development Tenant",
        "api_key": "dev-api-key",
        "tick_rate": 2.0,
    }

    if CONFIG_PATH.exists():
        with open(CONFIG_PATH, "r", encoding="utf-8") as file:
            file_config = json.load(file)
            config.update(file_config)

    # Environment variable overrides
    config["gateway_url"] = os.getenv("AETHER_GATEWAY_URL", config["gateway_url"])
    config["device_id"] = os.getenv("AETHER_DEVICE_ID", config["device_id"])
    config["organization_name"] = os.getenv("AETHER_ORG_NAME", config["organization_name"])
    config["api_key"] = os.getenv("AETHER_API_KEY", config["api_key"])
    config["tick_rate"] = float(os.getenv("AETHER_TICK_RATE", config["tick_rate"]))

    return config


config = load_config()

GATEWAY_URL = config["gateway_url"]
DEVICE_ID = config["device_id"]
ORG_NAME = config["organization_name"]
API_KEY = config["api_key"]
TICK_RATE = float(config["tick_rate"])


# ------------------------------------------------------------
# Logging
# ------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)


# ------------------------------------------------------------
# Metric helpers
# ------------------------------------------------------------

def calculate_anomaly_score(cpu, ram):
    """
    Simple rule-based anomaly score.

    Later, this can be replaced with:
    - rolling z-score
    - isolation forest
    - LSTM/forecasting model
    - per-device learned baseline
    """

    base = max(0.0, float(cpu) - 40.0) * 1.3

    if cpu > 85 or ram > 85:
        return round(base + random.uniform(15.0, 30.0), 1)

    return round(max(0.0, base + random.uniform(-2.0, 2.0)), 1)


def get_disk_usage():
    try:
        return psutil.disk_usage("/").percent
    except Exception:
        return 0.0


def get_network_counters():
    try:
        net = psutil.net_io_counters()
        return {
            "bytes_sent": int(net.bytes_sent),
            "bytes_recv": int(net.bytes_recv),
            "packets_sent": int(net.packets_sent),
            "packets_recv": int(net.packets_recv),
        }
    except Exception:
        return {
            "bytes_sent": 0,
            "bytes_recv": 0,
            "packets_sent": 0,
            "packets_recv": 0,
        }


def get_system_info():
    return {
        "hostname": socket.gethostname(),
        "platform": platform.system(),
        "platform_release": platform.release(),
        "platform_version": platform.version(),
        "architecture": platform.machine(),
        "processor": platform.processor(),
    }


def build_payload():
    cpu_percent = psutil.cpu_percent(interval=None)
    mem_percent = psutil.virtual_memory().percent
    disk_percent = get_disk_usage()
    anomaly_score = calculate_anomaly_score(cpu_percent, mem_percent)
    network = get_network_counters()

    packet_type = "METRIC"
    event_type = "NOMINAL"

    if cpu_percent >= 85 or mem_percent >= 90 or anomaly_score >= 75:
        packet_type = "ALERT"
        event_type = "CRITICAL_SPIKE"

    payload = {
        "device_id": DEVICE_ID,
        "organization_name": ORG_NAME,
        "packet_type": packet_type,
        "event_type": event_type,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "agent": {
            "name": "aether-python-agent",
            "version": "0.1.0",
            "config_path": str(CONFIG_PATH),
        },
        "system": get_system_info(),
        "metrics": {
            "cpu_usage_pct": float(cpu_percent),
            "memory_usage_pct": float(mem_percent),
            "disk_usage_pct": float(disk_percent),
            "anomaly_score": float(anomaly_score),
            "throughput": int(13000 + random.randint(-1000, 1000)),
            "network_bytes_sent": network["bytes_sent"],
            "network_bytes_recv": network["bytes_recv"],
            "network_packets_sent": network["packets_sent"],
            "network_packets_recv": network["packets_recv"],
        },
    }

    return payload


# ------------------------------------------------------------
# Main telemetry loop
# ------------------------------------------------------------

async def stream_telemetry():
    print("=====================================================")
    print("Real-Time AETHER Agent Online")
    print(f"Target Node Identity: {DEVICE_ID}")
    print(f"Organization:         {ORG_NAME}")
    print(f"Exporting Pipeline:   {GATEWAY_URL}")
    print(f"Config Path:          {CONFIG_PATH}")
    print(f"Tick Rate:            {TICK_RATE}s")
    print("=====================================================")

    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
        "User-Agent": "aether-python-agent/0.1.0",
    }

    async with httpx.AsyncClient(timeout=5.0) as client:
        while True:
            try:
                payload = build_payload()

                response = await client.post(
                    GATEWAY_URL,
                    headers=headers,
                    json=payload,
                )

                response.raise_for_status()

                metrics = payload["metrics"]

                logging.info(
                    "Frame posted -> "
                    f"CPU: {metrics['cpu_usage_pct']}% | "
                    f"RAM: {metrics['memory_usage_pct']}% | "
                    f"Disk: {metrics['disk_usage_pct']}% | "
                    f"Score: {metrics['anomaly_score']} | "
                    f"Gateway: {response.status_code}"
                )

                await asyncio.sleep(TICK_RATE)

            except httpx.ConnectError:
                logging.warning(
                    f"Gateway unavailable at {GATEWAY_URL}. Retrying in 3s..."
                )
                await asyncio.sleep(3)

            except httpx.TimeoutException:
                logging.warning(
                    f"Gateway timeout at {GATEWAY_URL}. Retrying in 3s..."
                )
                await asyncio.sleep(3)

            except httpx.HTTPStatusError as e:
                logging.error(
                    f"Gateway rejected packet: "
                    f"{e.response.status_code} {e.response.text}"
                )
                await asyncio.sleep(3)

            except KeyboardInterrupt:
                raise

            except Exception as e:
                logging.error(f"Agent exception loop: {e}")
                await asyncio.sleep(3)


if __name__ == "__main__":
    try:
        asyncio.run(stream_telemetry())
    except KeyboardInterrupt:
        print("\nTelemetry stream paused by operator.")