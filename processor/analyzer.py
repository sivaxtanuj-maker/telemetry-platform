import json
import asyncio
from aiokafka import AIOKafkaConsumer, AIOKafkaProducer

KAFKA_BOOTSTRAP_SERVERS = "localhost:9092"
INPUT_TOPIC = "telemetry-stream"
OUTPUT_ALERT_TOPIC = "alerts-stream"

# The Cloud SLA threshold rules
CPU_THRESHOLD_MAX = 80.0

async def analyze_stream():
    print("🧠 Starting AI Anomaly & Alerting Engine worker...")
    
    # Configure Consumer to read metrics
    consumer = AIOKafkaConsumer(
        INPUT_TOPIC,
        bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
        group_id="analytics-alert-group",
        auto_offset_reset="latest"
    )
    
    # Configure Producer to publish alert events
    producer = AIOKafkaProducer(bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS)
    
    await consumer.start()
    await producer.start()
    
    print("⚡ Listening to telemetry-stream pipeline for SLA violations...")
    
    try:
        async for msg in consumer:
            packet = json.loads(msg.value.decode('utf-8'))
            
            device_id = packet.get("device_id")
            metrics = packet.get("metrics", {})
            cpu = metrics.get("cpu_usage_pct", 0)
            org_name = packet.get("organization_name", "Unknown Tenant")
            
            # 🚨 CHECK FOR CRITICAL ANOMALIES
            if cpu > CPU_THRESHOLD_MAX:
                alert_event = {
                    "event_type": "CRITICAL_SPIKE",
                    "organization_name": org_name,
                    "device_id": device_id,
                    "message": f"SLA Violation: CPU utilization reached an unauthorized {cpu}% threshold limit!",
                    "timestamp": packet.get("timestamp")
                }
                
                # Fire alert into the alert pipeline topic
                await producer.send_and_wait(
                    OUTPUT_ALERT_TOPIC, 
                    json.dumps(alert_event).encode('utf-8')
                )
                print(f"🔥 [ANOMALY DETECTED] Red Flag raised for {device_id} ({cpu}%)")
                
    except Exception as e:
        print(f"Error in analyzer loop: {e}")
    finally:
        await consumer.stop()
        await producer.stop()

if __name__ == "__main__":
    asyncio.run(analyze_stream())