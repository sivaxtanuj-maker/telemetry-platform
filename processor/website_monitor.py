import asyncio
import json
import os
import time
from datetime import datetime, timezone

import asyncpg
import httpx

from kafka_client import KAFKA_BOOTSTRAP_SERVERS, get_kafka_producer


RAW_DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://aether:aether_password@localhost:5432/aether_db",
)

DATABASE_URL = RAW_DATABASE_URL.replace(
    "postgresql+asyncpg://",
    "postgresql://",
)

WEBSITE_TOPIC = "website-monitor-stream"

producer = None
db_pool = None


def utc_now():
    return datetime.now(timezone.utc)


def utc_now_iso():
    return utc_now().isoformat()


async def fetch_websites():
    async with db_pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                website_id,
                organization_id,
                name,
                url,
                expected_status,
                check_interval_seconds,
                status,
                last_checked,
                last_status_code,
                last_latency_ms,
                last_error,
                created_at
            FROM website_monitors
            ORDER BY created_at DESC
            """
        )

    return [dict(row) for row in rows]


async def update_website_result(result):
    checked_at = datetime.fromisoformat(result["timestamp"])

    async with db_pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE website_monitors
            SET
                status = $1,
                last_checked = $2,
                last_status_code = $3,
                last_latency_ms = $4,
                last_error = $5
            WHERE website_id = $6
            """,
            result["status"],
            checked_at,
            result["status_code"],
            result["latency_ms"],
            result["error"],
            result["website_id"],
        )

        await conn.execute(
            """
            INSERT INTO website_check_results (
                organization_id,
                website_id,
                name,
                url,
                status,
                expected_status,
                status_code,
                latency_ms,
                error,
                checked_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            """,
            result["organization_id"],
            result["website_id"],
            result["name"],
            result["url"],
            result["status"],
            result["expected_status"],
            result["status_code"],
            result["latency_ms"],
            result["error"],
            checked_at,
        )


async def check_website(client, website):
    started = time.perf_counter()
    expected_status = int(website.get("expected_status", 200))

    try:
        response = await client.get(
            website["url"],
            timeout=8.0,
            follow_redirects=True,
        )

        latency_ms = round((time.perf_counter() - started) * 1000, 2)
        is_up = response.status_code == expected_status

        return {
            "packet_type": "WEBSITE",
            "event_type": "WEBSITE_CHECK",
            "organization_id": website["organization_id"],
            "website_id": website["website_id"],
            "name": website["name"],
            "url": website["url"],
            "status": "up" if is_up else "degraded",
            "expected_status": expected_status,
            "status_code": response.status_code,
            "latency_ms": latency_ms,
            "error": None,
            "timestamp": utc_now_iso(),
        }

    except Exception as e:
        latency_ms = round((time.perf_counter() - started) * 1000, 2)

        return {
            "packet_type": "WEBSITE",
            "event_type": "WEBSITE_CHECK",
            "organization_id": website["organization_id"],
            "website_id": website["website_id"],
            "name": website["name"],
            "url": website["url"],
            "status": "down",
            "expected_status": expected_status,
            "status_code": None,
            "latency_ms": latency_ms,
            "error": str(e),
            "timestamp": utc_now_iso(),
        }


async def publish_result(result):
    await producer.send_and_wait(
        WEBSITE_TOPIC,
        json.dumps(result).encode("utf-8"),
    )


async def monitor_loop():
    global producer
    global db_pool

    print("Starting AETHER Website Monitor worker...")
    print(f"Reading monitors from Postgres: {DATABASE_URL}")
    print(f"Publishing results to Kafka topic: {WEBSITE_TOPIC}")
    print(f"Kafka bootstrap servers: {KAFKA_BOOTSTRAP_SERVERS}")

    producer = get_kafka_producer()
    await producer.start()

    db_pool = await asyncpg.create_pool(DATABASE_URL)

    last_checked_by_site = {}

    try:
        async with httpx.AsyncClient() as client:
            while True:
                websites = await fetch_websites()
                now = time.time()

                if not websites:
                    print("No website monitors configured yet.")
                    await asyncio.sleep(5)
                    continue

                for website in websites:
                    website_id = website["website_id"]
                    interval = int(website.get("check_interval_seconds", 10))
                    interval = max(5, interval)

                    last_checked = last_checked_by_site.get(website_id, 0)

                    if now - last_checked < interval:
                        continue

                    result = await check_website(client, website)

                    await update_website_result(result)
                    await publish_result(result)

                    last_checked_by_site[website_id] = now

                    print(
                        f"{result['name']} -> "
                        f"{result['status'].upper()} | "
                        f"status={result['status_code']} | "
                        f"latency={result['latency_ms']}ms | "
                        f"org={result['organization_id']}"
                    )

                await asyncio.sleep(1)

    finally:
        if producer:
            await producer.stop()

        if db_pool:
            await db_pool.close()


if __name__ == "__main__":
    try:
        asyncio.run(monitor_loop())
    except KeyboardInterrupt:
        print("\nWebsite monitor stopped.")