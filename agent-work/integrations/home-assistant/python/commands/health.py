from ha_client import HomeAssistantClient


def handle(_payload: dict, client: HomeAssistantClient) -> dict:
    api_payload = client.get('/api/')
    return {'api': api_payload}
