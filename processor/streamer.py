import asyncio
import json
import os
from datetime import datetime, timezone

from aiohttp import web

from kafka_client import KAFKA_BOOTSTRAP_SERVERS, get_kafka_consumer


TELEMETRY_TOPIC = "telemetry-stream"
ALERTS_TOPIC = "alerts-stream"
WEBSITE_TOPIC = "website-monitor-stream"

TOPICS = [TELEMETRY_TOPIC, ALERTS_TOPIC, WEBSITE_TOPIC]

PORT = int(os.getenv("PORT", "8765"))

CONNECTED_CLIENTS = set()

MESSAGE_COUNTS = {
    TELEMETRY_TOPIC: 0,
    ALERTS_TOPIC: 0,
    WEBSITE_TOPIC: 0,
}

LAST_MESSAGE_TOPIC = None
LAST_MESSAGE_RECEIVED_AT = None


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


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


async def start_background_consumers(app):
    app["consumer_tasks"] = [
        asyncio.create_task(consume_topic(topic)) for topic in TOPICS
    ]


async def cleanup_background_consumers(app):
    tasks = app.get("consumer_tasks", [])

    for task in tasks:
        task.cancel()

    await asyncio.gather(*tasks, return_exceptions=True)


def create_app():
    app = web.Application()
    app.router.add_get("/", health_handler)
    app.router.add_get("/health", health_handler)
    app.router.add_get("/ws", websocket_handler)

    app.on_startup.append(start_background_consumers)
    app.on_cleanup.append(cleanup_background_consumers)

    return app


if __name__ == "__main__":
    print(f"AETHER Streamer starting on port {PORT}")
    web.run_app(create_app(), host="0.0.0.0", port=PORT)