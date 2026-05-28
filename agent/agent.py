import asyncio
import json
import logging
import os
import random
import time

import httpx
import psutil

# Enterprise-style config through environment variables
GATEWAY_URL = os.getenv(
    "AETHER_GATEWAY_URL",
    "http://localhost:8000/api/v1/telemetry"
)

DEVICE_ID = os.getenv("AETHER_DEVICE_ID", "Windows-Workstation-Node01")
ORG_NAME = os.getenv("AETHER_ORG_NAME", "Local Development Tenant")
API_KEY = os.getenv("AETHER_API_KEY", "dev-api-key")
TICK_RATE = float(os.getenv("AETHER_TICK_RATE", "2.0"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)


def calculate_anomaly_score(cpu, ram):
    """
    Simple baseline anomaly score.
    Later, this can become a real ML model or rolling statistical detector.
    """
    base = max(0.0, float(cpu) - 40.0) * 1.3

    if cpu > 85 or ram > 85:
        return round(base + random.uniform(15.0, 30.0), 1)

    return round(max(0.0, base + random.uniform(-2.0, 2.0)), 1)


def build_payload():
    cpu_percent = psutil.cpu_percent(interval=None)
    mem_percent = psutil.virtual_memory().percent
    anomaly_score = calculate_anomaly_score(cpu_percent, mem_percent)

    packet_type = "METRIC"
    event_type = "NOMINAL"

    if cpu_percent >= 85 or anomaly_score >= 75:
        packet_type = "ALERT"
        event_type = "CRITICAL_SPIKE"

    return {
        "device_id": DEVICE_ID,
        "organization_name": ORG_NAME,
        "packet_type": packet_type,
        "event_type": event_type,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "metrics": {
            "cpu_usage_pct": float(cpu_percent),
            "memory_usage_pct": float(mem_percent),
            "anomaly_score": float(anomaly_score),
            "throughput": int(13000 + random.randint(-1000, 1000)),
        },
    }


async def stream_telemetry():
    print("=====================================================")
    print("Real-Time AETHER Agent Online")
    print(f"Target Node Identity: {DEVICE_ID}")
    print(f"Organization:         {ORG_NAME}")
    print(f"Exporting Pipeline:   {GATEWAY_URL}")
    print("=====================================================")

    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
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
                    f"Score: {metrics['anomaly_score']} | "
                    f"Gateway: {response.status_code}"
                )

                await asyncio.sleep(TICK_RATE)

            except httpx.ConnectError:
                logging.warning(
                    f"Gateway unavailable at {GATEWAY_URL}. Retrying in 3s..."
                )
                await asyncio.sleep(3)

            except httpx.HTTPStatusError as e:
                logging.error(
                    f"Gateway rejected packet: {e.response.status_code} {e.response.text}"
                )
                await asyncio.sleep(3)

            except Exception as e:
                logging.error(f"Agent exception loop: {e}")
                await asyncio.sleep(3)


if __name__ == "__main__":
    try:
        asyncio.run(stream_telemetry())
    except KeyboardInterrupt:
        print("\nTelemetry stream paused by operator.")