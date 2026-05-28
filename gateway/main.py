import json
import os
from contextlib import asynccontextmanager
from typing import Optional, Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from aiokafka import AIOKafkaProducer

KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")
TELEMETRY_TOPIC = "telemetry-stream"

producer: Optional[AIOKafkaProducer] = None
clients: Set[WebSocket] = set()


async def publish_to_kafka(packet: dict):
    if producer is None:
        return

    await producer.send_and_wait(
        TELEMETRY_TOPIC,
        json.dumps(packet).encode("utf-8")
    )


async def broadcast_packet(packet: dict, exclude: Optional[WebSocket] = None):
    message = json.dumps(packet)
    dead_clients = []

    for client in list(clients):
        if client is exclude:
            continue

        try:
            await client.send_text(message)
        except Exception:
            dead_clients.append(client)

    for client in dead_clients:
        clients.discard(client)


async def handle_packet(packet: dict, source: Optional[WebSocket] = None):
    device_id = packet.get("device_id", "unknown-device")
    print(f"Telemetry received from {device_id}")

    await publish_to_kafka(packet)
    await broadcast_packet(packet, exclude=source)

    print(f"Telemetry published and broadcasted from {device_id}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global producer

    print("Starting gateway...")

    try:
        producer = AIOKafkaProducer(bootstrap_servers=KAFKA_BOOTSTRAP)
        await producer.start()
        print(f"Kafka producer connected at {KAFKA_BOOTSTRAP}")
    except Exception as e:
        producer = None
        print(f"Kafka unavailable. Gateway will still run. Reason: {e}")

    yield

    if producer is not None:
        await producer.stop()
        print("Kafka producer stopped")


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {
        "status": "gateway-online",
        "connected_websocket_clients": len(clients),
        "kafka_enabled": producer is not None,
    }


@app.post("/api/v1/telemetry")
async def receive_telemetry(data: dict):
    await handle_packet(data)
    return {"status": "published"}


@app.websocket("/")
async def websocket_root(websocket: WebSocket):
    await websocket.accept()
    clients.add(websocket)

    print(f"WebSocket client connected. Total clients: {len(clients)}")

    try:
        while True:
            raw_message = await websocket.receive_text()

            try:
                packet = json.loads(raw_message)
            except json.JSONDecodeError:
                print("Invalid JSON received over WebSocket")
                continue

            await handle_packet(packet, source=websocket)

    except WebSocketDisconnect:
        clients.discard(websocket)
        print(f"WebSocket client disconnected. Total clients: {len(clients)}")





@app.get("/health")
async def health_check():
    kafka_status = producer is not None

    return {
        "service": "aether-gateway",
        "status": "online",
        "kafka_connected": kafka_status,
        "ingest_endpoint": "/api/v1/telemetry"
    }