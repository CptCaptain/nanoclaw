from typing import Any

from ha_client import HomeAssistantClient


def handle(payload: dict[str, Any], client: HomeAssistantClient) -> dict:
    entity_id = payload.get('entity_id')
    if not isinstance(entity_id, str) or not entity_id.strip():
        raise ValueError('"entity_id" must be a non-empty string')

    temperature = payload.get('temperature')
    hvac_mode = payload.get('hvac_mode')

    if temperature is None and hvac_mode is None:
        raise ValueError('At least one of "temperature" or "hvac_mode" is required')

    body: dict[str, Any] = {'entity_id': entity_id}

    if temperature is not None:
        body['temperature'] = temperature
    if hvac_mode is not None:
        body['hvac_mode'] = hvac_mode

    service = 'set_temperature' if temperature is not None else 'set_hvac_mode'
    result = client.post(f'/api/services/climate/{service}', body)
    return {'result': result}
