import os

from aiokafka import AIOKafkaProducer


KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "").strip()

KAFKA_SECURITY_PROTOCOL = os.getenv("KAFKA_SECURITY_PROTOCOL")
KAFKA_SASL_MECHANISM = os.getenv("KAFKA_SASL_MECHANISM")
KAFKA_USERNAME = os.getenv("KAFKA_USERNAME")
KAFKA_PASSWORD = os.getenv("KAFKA_PASSWORD")


def kafka_auth_config():
    config = {
        "bootstrap_servers": KAFKA_BOOTSTRAP_SERVERS,
    }

    if KAFKA_SECURITY_PROTOCOL:
        config["security_protocol"] = KAFKA_SECURITY_PROTOCOL

    if KAFKA_SASL_MECHANISM:
        config["sasl_mechanism"] = KAFKA_SASL_MECHANISM

    if KAFKA_USERNAME:
        config["sasl_plain_username"] = KAFKA_USERNAME

    if KAFKA_PASSWORD:
        config["sasl_plain_password"] = KAFKA_PASSWORD

    return config


def get_kafka_producer():
    if not KAFKA_BOOTSTRAP_SERVERS:
        return None

    return AIOKafkaProducer(**kafka_auth_config())