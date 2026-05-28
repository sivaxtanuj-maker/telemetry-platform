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
#
# Supports two modes:
# 1. Existing config mode:
#    - Reads agent_config.json
#    - Sends telemetry with saved device API key
#
# 2. Enrollment mode:
#    - Reads AETHER_ENROLLMENT_TOKEN
#    - Registers device with gateway
#    - Saves returned config into agent_config.json
#    - Starts sending telemetry automatically
# ============================================================


DEFAULT_CONFIG_PATH = Path(__file__).parent / "agent_config.json"

CONFIG_PATH = Path(
    os.getenv("AETHER_AGENT_CONFIG", str(DEFAULT_CONFIG_PATH))
)

DEFAULT_GATEWAY_URL = os.getenv(
    "AETHER_GATEWAY_URL",
    "http://localhost:8000/api/v1/telemetry",
)

AGENT_VERSION = "0.1.0"


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)


def get_default_device_id():
    system_name = platform.system() or "UnknownOS"
    hostname = socket.gethostname() or "UnknownHost"
    return f"{system_name}-{hostname}"


def get_system_info():
    return {
        "hostname": socket.gethostname(),
        "platform": platform.system(),
        "platform_release": platform.release(),
        "platform_version": platform.version(),
        "architecture": platform.machine(),
        "processor": platform.processor(),
    }


def build_register_url(gateway_url):
    """
    Converts:
      http://host:8000/api/v1/telemetry

    Into:
      http://host:8000/api/v1/devices/register
    """

    if gateway_url.endswith("/api/v1/telemetry"):
        return gateway_url.replace(
            "/api/v1/telemetry",
            "/api/v1/devices/register",
        )

    return os.getenv(
        "AETHER_REGISTER_URL",
        "http://localhost:8000/api/v1/devices/register",
    )


def load_config_file():
    if not CONFIG_PATH.exists():
        return None

    with open(CONFIG_PATH, "r", encoding="utf-8") as file:
        return json.load(file)


def save_config_file(config):
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)

    with open(CONFIG_PATH, "w", encoding="utf-8") as file:
        json.dump(config, file, indent=2)

    logging.info(f"Saved agent config to {CONFIG_PATH}")


def apply_env_overrides(config):
    """
    Environment variables override config file values.
    This is useful for WSL, Docker, LAN demos, and production deployments.
    """

    config["gateway_url"] = os.getenv("AETHER_GATEWAY_URL", config["gateway_url"])
    config["device_id"] = os.getenv("AETHER_DEVICE_ID", config["device_id"])
    config["organization_name"] = os.getenv(
        "AETHER_ORG_NAME",
        config["organization_name"],
    )
    config["api_key"] = os.getenv("AETHER_API_KEY", config["api_key"])
    config["tick_rate"] = float(os.getenv("AETHER_TICK_RATE", config["tick_rate"]))

    return config


def register_device_with_enrollment_token(enrollment_token, gateway_url):
    register_url = build_register_url(gateway_url)
    system_info = get_system_info()

    payload = {
        "enrollment_token": enrollment_token,
        "hostname": system_info["hostname"],
        "platform": system_info["platform"].lower(),
        "agent_version": AGENT_VERSION,
    }

    logging.info(f"Registering device with enrollment endpoint: {register_url}")

    response = httpx.post(
        register_url,
        json=payload,
        timeout=10.0,
    )

    response.raise_for_status()

    data = response.json()

    returned_config = data["config"]

    # Important:
    # The backend may return localhost for local testing.
    # If the user supplied AETHER_GATEWAY_URL, preserve that because it may be
    # a LAN IP like http://192.168.1.25:8000/api/v1/telemetry.
    returned_config["gateway_url"] = os.getenv(
        "AETHER_GATEWAY_URL",
        returned_config["gateway_url"],
    )

    save_config_file(returned_config)

    logging.info(
        f"Device registered successfully as {returned_config['device_id']}"
    )

    return returned_config


def load_or_enroll_config():
    enrollment_token = os.getenv("AETHER_ENROLLMENT_TOKEN")

    existing_config = load_config_file()

    if existing_config and not enrollment_token:
        return apply_env_overrides(existing_config)

    default_config = {
        "gateway_url": DEFAULT_GATEWAY_URL,
        "device_id": get_default_device_id(),
        "organization_name": os.getenv(
            "AETHER_ORG_NAME",
            "Local Development Tenant",
        ),
        "api_key": os.getenv("AETHER_API_KEY", "dev-api-key"),
        "tick_rate": float(os.getenv("AETHER_TICK_RATE", "2.0")),
    }

    if existing_config:
        default_config.update(existing_config)

    default_config = apply_env_overrides(default_config)

    if enrollment_token:
        return register_device_with_enrollment_token(
            enrollment_token=enrollment_token,
            gateway_url=default_config["gateway_url"],
        )

    return default_config


def calculate_anomaly_score(cpu, ram):
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


def build_payload(config):
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

    return {
        "device_id": config["device_id"],
        "organization_name": config["organization_name"],
        "packet_type": packet_type,
        "event_type": event_type,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "agent": {
            "name": "aether-python-agent",
            "version": AGENT_VERSION,
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


async def stream_telemetry(config):
    gateway_url = config["gateway_url"]
    device_id = config["device_id"]
    organization_name = config["organization_name"]
    api_key = config["api_key"]
    tick_rate = float(config["tick_rate"])

    print("=====================================================")
    print("Real-Time AETHER Agent Online")
    print(f"Target Node Identity: {device_id}")
    print(f"Organization:         {organization_name}")
    print(f"Exporting Pipeline:   {gateway_url}")
    print(f"Config Path:          {CONFIG_PATH}")
    print(f"Tick Rate:            {tick_rate}s")
    print("=====================================================")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "User-Agent": f"aether-python-agent/{AGENT_VERSION}",
    }

    async with httpx.AsyncClient(timeout=5.0) as client:
        while True:
            try:
                payload = build_payload(config)

                response = await client.post(
                    gateway_url,
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

                await asyncio.sleep(tick_rate)

            except httpx.ConnectError:
                logging.warning(
                    f"Gateway unavailable at {gateway_url}. Retrying in 3s..."
                )
                await asyncio.sleep(3)

            except httpx.TimeoutException:
                logging.warning(
                    f"Gateway timeout at {gateway_url}. Retrying in 3s..."
                )
                await asyncio.sleep(3)

            except httpx.HTTPStatusError as e:
                logging.error(
                    "Gateway rejected packet: "
                    f"{e.response.status_code} {e.response.text}"
                )
                await asyncio.sleep(3)

            except KeyboardInterrupt:
                raise

            except Exception as e:
                logging.error(f"Agent exception loop: {e}")
                await asyncio.sleep(3)


def main():
    try:
        config = load_or_enroll_config()
        asyncio.run(stream_telemetry(config))

    except KeyboardInterrupt:
        print("\nTelemetry stream paused by operator.")

    except httpx.HTTPStatusError as e:
        print(
            f"\nDevice enrollment failed: "
            f"{e.response.status_code} {e.response.text}"
        )

    except Exception as e:
        print(f"\nAgent startup failed: {e}")


if __name__ == "__main__":
    main()