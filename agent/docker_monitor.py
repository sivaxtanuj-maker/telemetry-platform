import time
import docker # Hooks directly into your running Docker Desktop application
import requests

API_GATEWAY_URL = "http://localhost:8000/api/v1/telemetry"
HEADERS = {
    "X-API-Key": "sk_live_drone_fleet_xyz123",
    "Content-Type": "application/json"
}

def stream_docker_container_metrics():
    print("🐳 Docker Engine Infrastructure Monitor Active...")
    client = docker.from_env()

    while True:
        try:
            # 🔄 Target the actual running Kafka container containerized on your system
            container = client.containers.get("telemetry_kafka")
            stats = container.stats(stream=False)

            # Calculate actual CPU usage percentage from the Docker cgroup stats
            cpu_delta = stats["cpu_stats"]["cpu_usage"]["total_usage"] - stats["precpu_stats"]["cpu_usage"]["total_usage"]
            system_delta = stats["cpu_stats"]["system_cpu_usage"] - stats["precpu_stats"]["system_cpu_usage"]
            
            actual_cpu = 0.0
            if system_delta > 0 and cpu_delta > 0:
                actual_cpu = (cpu_delta / system_delta) * len(stats["cpu_stats"]["cpu_usage"].get("percpu_usage", [1])) * 100.0

            # Calculate actual Memory usage percentage
            mem_usage = stats["memory_stats"]["usage"]
            mem_limit = stats["memory_stats"]["limit"]
            actual_ram = (mem_usage / mem_limit) * 100.0

            payload = {
                "device_id": "Docker-Container-Kafka",
                "metrics": {
                    "cpu_usage_pct": round(actual_cpu, 1),
                    "memory_usage_pct": round(actual_ram, 1)
                }
            }

            requests.post(API_GATEWAY_URL, json=payload, headers=HEADERS, timeout=2)
            print(f"🛰️ Logged Docker Infrastructure Vitals -> CPU: {round(actual_cpu, 1)}%")

        except Exception as e:
            print(f"⚠️ Container Monitor Syncing: {e}")
            
        time.sleep(1)

if __name__ == "__main__":
    stream_docker_container_metrics()