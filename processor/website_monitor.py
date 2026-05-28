import asyncio
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
from aiokafka import AIOKafkaProducer


KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
WEBSITE_TOPIC = "website-monitor-stream"

PROJECT_ROOT = Path(__file__).resolve().parent.parent
WEBSITES_FILE = PROJECT_ROOT / "gateway" / "data" / "websites.json"

producer = None


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def read_websites():
    if not WEBSITES_FILE.exists():
        return {}

    try:
        return json.loads(WEBSITES_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def write_websites(websites):
    WEBSITES_FILE.parent.mkdir(parents=True, exist_ok=True)
    WEBSITES_FILE.write_text(json.dumps(websites, indent=2), encoding="utf-8")


async def check_website(client, website):
    website_id = website["website_id"]
    url = website["url"]
    expected_status = int(website.get("expected_status", 200))

    started = time.perf_counter()

    try:
        response = await client.get(url, timeout=8.0, follow_redirects=True)
        latency_ms = round((time.perf_counter() - started) * 1000, 2)

        is_up = response.status_code == expected_status

        result = {
            "packet_type": "WEBSITE",
            "event_type": "WEBSITE_CHECK",
            "website_id": website_id,
            "name": website["name"],
            "url": url,
            "status": "up" if is_up else "degraded",
            "expected_status": expected_status,
            "status_code": response.status_code,
            "latency_ms": latency_ms,
            "error": None,
            "timestamp": utc_now_iso(),
        }

    except Exception as e:
        latency_ms = round((time.perf_counter() - started) * 1000, 2)

        result = {
            "packet_type": "WEBSITE",
            "event_type": "WEBSITE_CHECK",
            "website_id": website_id,
            "name": website["name"],
            "url": url,
            "status": "down",
            "expected_status": expected_status,
            "status_code": None,
            "latency_ms": latency_ms,
            "error": str(e),
            "timestamp": utc_now_iso(),
        }

    return result


async def publish_result(result):
    await producer.send_and_wait(
        WEBSITE_TOPIC,
        json.dumps(result).encode("utf-8"),
    )


async def monitor_loop():
    global producer

    print("🌐 Starting AETHER Website Monitor worker...")
    print(f"📁 Reading monitors from: {WEBSITES_FILE}")
    print(f"📡 Publishing results to Kafka topic: {WEBSITE_TOPIC}")

    producer = AIOKafkaProducer(bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS)
    await producer.start()

    last_checked_by_site = {}

    try:
        async with httpx.AsyncClient() as client:
            while True:
                websites = read_websites()
                now = time.time()

                if not websites:
                    print("⚠️  No website monitors configured yet.")
                    await asyncio.sleep(5)
                    continue

                for website_id, website in websites.items():
                    interval = int(website.get("check_interval_seconds", 10))
                    last_checked = last_checked_by_site.get(website_id, 0)

                    if now - last_checked < interval:
                        continue

                    result = await check_website(client, website)

                    websites[website_id]["status"] = result["status"]
                    websites[website_id]["last_checked"] = result["timestamp"]
                    websites[website_id]["last_status_code"] = result["status_code"]
                    websites[website_id]["last_latency_ms"] = result["latency_ms"]
                    websites[website_id]["last_error"] = result["error"]

                    write_websites(websites)
                    await publish_result(result)

                    last_checked_by_site[website_id] = now

                    print(
                        f"🌐 {result['name']} -> "
                        f"{result['status'].upper()} | "
                        f"status={result['status_code']} | "
                        f"latency={result['latency_ms']}ms"
                    )

                await asyncio.sleep(1)

    finally:
        await producer.stop()


if __name__ == "__main__":
    try:
        asyncio.run(monitor_loop())
    except KeyboardInterrupt:
        print("\nWebsite monitor stopped.")