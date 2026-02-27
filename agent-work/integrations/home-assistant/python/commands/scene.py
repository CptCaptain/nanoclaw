from ha_client import HomeAssistantClient


def handle(payload: dict, client: HomeAssistantClient) -> dict:
    entity_id = payload.get('entity_id')
    if not isinstance(entity_id, str) or not entity_id.strip():
        raise ValueError('"entity_id" must be a non-empty string')

    result = client.post('/api/services/scene/turn_on', {'entity_id': entity_id})
    return {'result': result}
