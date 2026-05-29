import os
import ssl

from aiokafka import AIOKafkaProducer


KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "").strip()

KAFKA_SECURITY_PROTOCOL = os.getenv("KAFKA_SECURITY_PROTOCOL", "").strip()
KAFKA_SASL_MECHANISM = os.getenv("KAFKA_SASL_MECHANISM", "").strip()
KAFKA_USERNAME = os.getenv("KAFKA_USERNAME", "").strip()
KAFKA_PASSWORD = os.getenv("KAFKA_PASSWORD", "").strip()

KAFKA_CA_CERT_PATH = os.getenv("KAFKA_CA_CERT_PATH", "").strip()


def build_ssl_context():
    """
    Aiven Kafka uses TLS. aiokafka requires an explicit SSLContext when
    security_protocol is SSL or SASL_SSL.
    """
    if KAFKA_CA_CERT_PATH:
        return ssl.create_default_context(cafile=KAFKA_CA_CERT_PATH)

    return ssl.create_default_context()


def kafka_auth_config():
    config = {
        "bootstrap_servers": KAFKA_BOOTSTRAP_SERVERS,
    }

    if KAFKA_SECURITY_PROTOCOL:
        config["security_protocol"] = KAFKA_SECURITY_PROTOCOL

    if KAFKA_SECURITY_PROTOCOL in {"SSL", "SASL_SSL"}:
        config["ssl_context"] = build_ssl_context()

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