import asyncio
import websockets
import json
from aiokafka import AIOKafkaConsumer

KAFKA_BOOTSTRAP_SERVERS = "localhost:9092"
METRICS_TOPIC = "telemetry-stream"
ALERTS_TOPIC = "alerts-stream"

CONNECTED_CLIENTS = set()

async def register(websocket):
    CONNECTED_CLIENTS.add(websocket)
    print(f"🔌 Browser connected. Total clients: {len(CONNECTED_CLIENTS)}")
    try:
        await websocket.wait_closed()
    finally:
        CONNECTED_CLIENTS.remove(websocket)
        print(f"🔌 Browser disconnected. Total clients: {len(CONNECTED_CLIENTS)}")

async def broadcast_to_uis(message_dict):
    # 🟢 ADD THIS LINE TO FIX THE UNBOUNDLOCALERROR:
    global CONNECTED_CLIENTS
    
    if not CONNECTED_CLIENTS:
        print("⚠️  No connected clients to broadcast to")
        return
    payload = json.dumps(message_dict)
    dead = set()
    for client in CONNECTED_CLIENTS:
        try:
            await client.send(payload)
            print(f"📤 Sent to browser: {payload[:80]}...")
        except Exception as e:
            print(f"💥 Failed to send to client: {e}")
            dead.add(client)
    CONNECTED_CLIENTS -= dead

async def consume_topic(topic_name):
    print(f"🎧 Starting consumer for topic: {topic_name}")
    consumer = AIOKafkaConsumer(
        topic_name,
        bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
        auto_offset_reset="latest"
    )
    await consumer.start()
    print(f"✅ Consumer ready for topic: {topic_name}")
    try:
        async for msg in consumer:
            print(f"📨 Message received from Kafka topic [{topic_name}]: {msg.value[:80]}")
            data = json.loads(msg.value.decode('utf-8'))
            data["packet_type"] = "ALERT" if topic_name == ALERTS_TOPIC else "METRIC"
            await broadcast_to_uis(data)
    finally:
        await consumer.stop()

async def main():
    print("🟢 Multi-Stream WebSocket Server listening on ws://localhost:8765")
    server = await websockets.serve(register, "0.0.0.0", 8765)
    await asyncio.gather(
        server.wait_closed(),
        consume_topic(METRICS_TOPIC),
        consume_topic(ALERTS_TOPIC)
    )

if __name__ == "__main__":
    asyncio.run(main())