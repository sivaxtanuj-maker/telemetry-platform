from aiohttp import web
import asyncio
import json
import os
from datetime import datetime, timezone

import websockets
from aiokafka import AIOKafkaConsumer


KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")

METRICS_TOPIC = "telemetry-stream"
ALERTS_TOPIC = "alerts-stream"
WEBSITE_TOPIC = "website-monitor-stream"
TOPICS = [METRICS_TOPIC, ALERTS_TOPIC, WEBSITE_TOPIC]

WEBSOCKET_HOST = "0.0.0.0"
WEBSOCKET_PORT = 8765

HEALTH_HOST = "0.0.0.0"
HEALTH_PORT = 8766

CONNECTED_CLIENTS = set()

LAST_MESSAGE_TOPIC = None
LAST_MESSAGE_AT = None

MESSAGE_COUNTS = {
    METRICS_TOPIC: 0,
    ALERTS_TOPIC: 0,
   WEBSITE_TOPIC: 0,
}


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


async def register(websocket):
    CONNECTED_CLIENTS.add(websocket)
    print(f"🔌 Browser connected. Total clients: {len(CONNECTED_CLIENTS)}")

    try:
        await websocket.wait_closed()
    finally:
        CONNECTED_CLIENTS.discard(websocket)
        print(f"🔌 Browser disconnected. Total clients: {len(CONNECTED_CLIENTS)}")


async def broadcast_to_uis(message_dict):
    if not CONNECTED_CLIENTS:
        print("⚠️  No connected clients to broadcast to")
        return

    payload = json.dumps(message_dict)
    dead_clients = set()

    for client in list(CONNECTED_CLIENTS):
        try:
            await client.send(payload)
            print(f"📤 Sent to browser: {payload[:80]}...")
        except Exception as e:
            print(f"💥 Failed to send to client: {e}")
            dead_clients.add(client)

    for client in dead_clients:
        CONNECTED_CLIENTS.discard(client)


async def consume_topic(topic_name):
    global LAST_MESSAGE_TOPIC
    global LAST_MESSAGE_AT

    print(f"🎧 Starting consumer for topic: {topic_name}")

    consumer = AIOKafkaConsumer(
        topic_name,
        bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
        auto_offset_reset="latest",
    )

    await consumer.start()
    print(f"✅ Consumer ready for topic: {topic_name}")

    try:
        async for msg in consumer:
            LAST_MESSAGE_TOPIC = topic_name
            LAST_MESSAGE_AT = utc_now_iso()
            MESSAGE_COUNTS.setdefault(topic_name, 0)
            MESSAGE_COUNTS[topic_name] += 1

            print(f"📨 Message received from Kafka topic [{topic_name}]: {msg.value[:80]}")

            data = json.loads(msg.value.decode("utf-8"))
            if topic_name == ALERTS_TOPIC:
                data["packet_type"] = "ALERT"
            elif topic_name == WEBSITE_TOPIC:
                data["packet_type"] = "WEBSITE"
            else:
                data["packet_type"] = "METRIC"



            data["streamer_received_at"] = LAST_MESSAGE_AT
            data["streamer_topic"] = topic_name

            await broadcast_to_uis(data)

    finally:
        await consumer.stop()
        print(f"🛑 Consumer stopped for topic: {topic_name}")


async def health_check(request):
    response = {
        "service": "aether-streamer",
        "status": "online",
        "websocket_url": f"ws://localhost:{WEBSOCKET_PORT}",
        "health_url": f"http://localhost:{HEALTH_PORT}/health",
        "kafka_bootstrap_servers": KAFKA_BOOTSTRAP_SERVERS,
        "connected_clients": len(CONNECTED_CLIENTS),
        "topics": TOPICS,
        "last_message_topic": LAST_MESSAGE_TOPIC,
        "last_message_received_at": LAST_MESSAGE_AT,
        "message_counts": MESSAGE_COUNTS,
    }

    return web.json_response(
        response,
        headers={
            "Access-Control-Allow-Origin": "*"
        },
    )


async def start_health_server():
    app = web.Application()
    app.router.add_get("/health", health_check)

    runner = web.AppRunner(app)
    await runner.setup()

    site = web.TCPSite(runner, HEALTH_HOST, HEALTH_PORT)
    await site.start()

    print(f"🩺 Streamer health server listening on http://localhost:{HEALTH_PORT}/health")

    return runner


async def main():
    print(f"🟢 Multi-Stream WebSocket Server listening on ws://localhost:{WEBSOCKET_PORT}")

    health_runner = await start_health_server()
    websocket_server = await websockets.serve(
        register,
        WEBSOCKET_HOST,
        WEBSOCKET_PORT,
    )

    try:
        await asyncio.gather(
           websocket_server.wait_closed(),
           consume_topic(METRICS_TOPIC),
           consume_topic(ALERTS_TOPIC),
           consume_topic(WEBSITE_TOPIC),
        )
    finally:
        websocket_server.close()
        await websocket_server.wait_closed()
        await health_runner.cleanup()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n🛑 Streamer stopped by operator.")