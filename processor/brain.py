import asyncio
import json
import math
from aiokafka import AIOKafkaConsumer

# Configuration Settings
KAFKA_BOOTSTRAP_SERVERS = "localhost:9092"
KAFKA_TOPIC = "telemetry-stream"

# Memory banks: Stores the last 10 CPU readings to learn what "normal" looks like
cpu_history = []
WINDOW_SIZE = 10

def check_for_anomaly(current_cpu):
    """Uses a dynamic statistical rolling window to find anomalies."""
    global cpu_history
    
    # Step 1: If we don't have enough data yet, just learn and say everything is normal
    if len(cpu_history) < WINDOW_SIZE:
        cpu_history.append(current_cpu)
        return False, 0.0, 0.0
    
    # Step 2: Calculate the moving average (mean)
    average = sum(cpu_history) / len(cpu_history)
    
    # Step 3: Calculate the Standard Deviation (how much the data fluctuates normally)
    variance = sum((x - average) ** 2 for x in cpu_history) / len(cpu_history)
    std_dev = math.sqrt(variance)
    
    # Step 4: Calculate the Threshold Boundary (Average + 2 Standard Deviations)
    # If the standard deviation is tiny (computer is dead silent), set a baseline minimum of 5.0
    threshold = average + (2 * max(std_dev, 5.0))
    
    # Step 5: Slide the window forward (Remove the oldest reading, add the newest)
    cpu_history.pop(0)
    cpu_history.append(current_cpu)
    
    # Step 6: Make the decision!
    if current_cpu > threshold:
        return True, average, threshold
    return False, average, threshold


async def start_brain():
    """Connects to Kafka as a Consumer and processes the live stream continuously."""
    print("🧠 The AI Brain Processor is booting up...")
    print(f"📡 Tuning into Kafka topic lane: '{KAFKA_TOPIC}'...")
    
    # Initialize the Consumer
    consumer = AIOKafkaConsumer(
        KAFKA_TOPIC,
        bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
        group_id="anomaly-detection-brain" # Tells Kafka who we are
    )
    
    # Start listening to the conveyor belt
    await consumer.start()
    print("🟢 Brain is linked to Kafka and listening for metrics! Let's analyze...")
    
    try:
        # Loop forever, waiting for Kafka to drop a new packet into our hands
        async for msg in consumer:
            # 1. Decompress the raw bytes back into readable text strings
            raw_json_string = msg.value.decode('utf-8')
            
            # 2. Parse the text string into a native Python dictionary
            data = json.loads(raw_json_string)
            
            device_id = data["device_id"]
            current_cpu = data["metrics"]["cpu_usage_pct"]
            
            # 3. Run the math anomaly model
            is_anomaly, avg, limit = check_for_anomaly(current_cpu)
            
            # 4. Display the results
            if is_anomaly:
                print(f"🚨 [ANOMALY DETECTED] Device: {device_id} | CPU shot up to: {current_cpu}%! (Normal history average is: {avg:.1f}%, limit was: {limit:.1f}%)")
            else:
                print(f"📊 [Brain Analyzing] Device: {device_id} | CPU: {current_cpu}% | Moving Avg: {avg:.1f}%")
                
    except Exception as e:
        print(f"❌ An error occurred in the brain processing loop: {e}")
    finally:
        # If we shut down, stop reading from Kafka cleanly
        await consumer.stop()

if __name__ == "__main__":
    # Launch our async background brain script
    asyncio.run(start_brain())