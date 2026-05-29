import asyncio
import json
import os
import time
from datetime import datetime, timezone

import asyncpg
import httpx
from aiohttp import web

from kafka_client import (
    KAFKA_BOOTSTRAP_SERVERS,
    get_kafka_consumer,
    get_kafka_producer,
)


TELEMETRY_TOPIC = "telemetry-stream"
ALERTS_TOPIC = "alerts-stream"
WEBSITE_TOPIC = "website-monitor-stream"

TOPICS = [TELEMETRY_TOPIC, ALERTS_TOPIC, WEBSITE_TOPIC]

PORT = int(os.getenv("PORT", "8765"))

RAW_DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
DATABASE_URL = RAW_DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")

CONNECTED_CLIENTS = set()

MESSAGE_COUNTS = {
    TELEMETRY_TOPIC: 0,
    ALERTS_TOPIC: 0,
    WEBSITE_TOPIC: 0,
}

LAST_MESSAGE_TOPIC = None
LAST_MESSAGE_RECEIVED_AT = None

db_pool = None
website_monitor_producer = None


def utc_now():
    return datetime.now(timezone.utc)


def utc_now_iso():
    return utc_now().isoformat()


async def websocket_handler(request):
    websocket = web.WebSocketResponse(heartbeat=30)
    await websocket.prepare(request)

    CONNECTED_CLIENTS.add(websocket)
    print(f"Browser connected. Total clients: {len(CONNECTED_CLIENTS)}")

    try:
        async for _ in websocket:
            pass
    finally:
        CONNECTED_CLIENTS.discard(websocket)
        print(f"Browser disconnected. Total clients: {len(CONNECTED_CLIENTS)}")

    return websocket


async def health_handler(request):
    return web.json_response(
        {
            "service": "aether-streamer",
            "status": "online",
            "websocket_url": "/ws",
            "health_url": "/health",
            "kafka_bootstrap_servers": KAFKA_BOOTSTRAP_SERVERS,
            "database_configured": bool(DATABASE_URL),
            "website_monitor_enabled": db_pool is not None and website_monitor_producer is not None,
            "connected_clients": len(CONNECTED_CLIENTS),
            "topics": TOPICS,
            "last_message_topic": LAST_MESSAGE_TOPIC,
            "last_message_received_at": LAST_MESSAGE_RECEIVED_AT,
            "message_counts": MESSAGE_COUNTS,
        }
    )


async def broadcast_to_clients(message_dict):
    if not CONNECTED_CLIENTS:
        return

    payload = json.dumps(message_dict)
    dead_clients = set()

    for client in CONNECTED_CLIENTS:
        try:
            await client.send_str(payload)
        except Exception:
            dead_clients.add(client)

    for client in dead_clients:
        CONNECTED_CLIENTS.discard(client)


async def consume_topic(topic_name):
    global LAST_MESSAGE_TOPIC
    global LAST_MESSAGE_RECEIVED_AT

    print(f"Starting Kafka consumer for topic: {topic_name}")

    consumer = get_kafka_consumer(
        topic_name=topic_name,
        group_id=f"aether-streamer-{topic_name}",
    )

    await consumer.start()
    print(f"Consumer ready for topic: {topic_name}")

    try:
        async for msg in consumer:
            try:
                data = json.loads(msg.value.decode("utf-8"))

                if topic_name == ALERTS_TOPIC:
                    data["packet_type"] = data.get("packet_type", "ALERT")
                elif topic_name == WEBSITE_TOPIC:
                    data["packet_type"] = data.get("packet_type", "WEBSITE")
                else:
                    data["packet_type"] = data.get("packet_type", "METRIC")

                MESSAGE_COUNTS[topic_name] = MESSAGE_COUNTS.get(topic_name, 0) + 1
                LAST_MESSAGE_TOPIC = topic_name
                LAST_MESSAGE_RECEIVED_AT = utc_now_iso()

                await broadcast_to_clients(data)

            except Exception as e:
                print(f"Failed to process message from {topic_name}: {e}")

    finally:
        await consumer.stop()
        print(f"Consumer stopped for topic: {topic_name}")


async def fetch_websites():
    if db_pool is None:
        return []

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
    if db_pool is None:
        return

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


async def publish_website_result(result):
    if website_monitor_producer is None:
        print("Website monitor producer unavailable. Skipping Kafka publish.")
        return

    await website_monitor_producer.send_and_wait(
        WEBSITE_TOPIC,
        json.dumps(result).encode("utf-8"),
    )


async def website_monitor_loop():
    global db_pool
    global website_monitor_producer

    if not DATABASE_URL:
        print("DATABASE_URL is not configured. Website monitor loop disabled.")
        return

    print("Starting embedded website monitor loop...")
    print(f"Reading website monitors from Postgres.")
    print(f"Publishing website results to Kafka topic: {WEBSITE_TOPIC}")

    try:
        db_pool = await asyncpg.create_pool(DATABASE_URL)
        website_monitor_producer = get_kafka_producer()

        if website_monitor_producer is not None:
            await website_monitor_producer.start()
        else:
            print("Kafka producer unavailable. Website checks will update DB only.")

    except Exception as e:
        print(f"Website monitor startup failed: {e}")
        db_pool = None
        website_monitor_producer = None
        return

    last_checked_by_site = {}

    try:
        async with httpx.AsyncClient() as client:
            while True:
                websites = await fetch_websites()
                now = time.time()

                if not websites:
                    print("No website monitors configured yet.")
                    await asyncio.sleep(10)
                    continue

                for website in websites:
                    website_id = website["website_id"]
                    interval = max(5, int(website.get("check_interval_seconds", 10)))
                    last_checked = last_checked_by_site.get(website_id, 0)

                    if now - last_checked < interval:
                        continue

                    result = await check_website(client, website)

                    await update_website_result(result)
                    await publish_website_result(result)

                    last_checked_by_site[website_id] = now

                    print(
                        f"{result['name']} -> "
                        f"{result['status'].upper()} | "
                        f"status={result['status_code']} | "
                        f"latency={result['latency_ms']}ms | "
                        f"org={result['organization_id']}"
                    )

                await asyncio.sleep(1)

    except asyncio.CancelledError:
        print("Website monitor loop cancelled.")
        raise

    finally:
        if website_monitor_producer is not None:
            await website_monitor_producer.stop()

        if db_pool is not None:
            await db_pool.close()


async def start_background_tasks(app):
    app["consumer_tasks"] = [
        asyncio.create_task(consume_topic(topic)) for topic in TOPICS
    ]

    app["website_monitor_task"] = asyncio.create_task(website_monitor_loop())


async def cleanup_background_tasks(app):
    tasks = app.get("consumer_tasks", [])

    website_monitor_task = app.get("website_monitor_task")

    if website_monitor_task:
        tasks.append(website_monitor_task)

    for task in tasks:
        task.cancel()

    await asyncio.gather(*tasks, return_exceptions=True)


def create_app():
    app = web.Application()
    app.router.add_get("/", health_handler)
    app.router.add_get("/health", health_handler)
    app.router.add_get("/ws", websocket_handler)

    app.on_startup.append(start_background_tasks)
    app.on_cleanup.append(cleanup_background_tasks)

    return app


if __name__ == "__main__":
    print(f"AETHER Streamer starting on port {PORT}")
    web.run_app(create_app(), host="0.0.0.0", port=PORT)