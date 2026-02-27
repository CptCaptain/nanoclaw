from typing import Any

from ha_client import HomeAssistantClient


def _entity_id(payload: dict[str, Any]) -> str | list[str]:
    entity_id = payload.get('entity_id')
    if isinstance(entity_id, str) and entity_id.strip():
        return entity_id
    if isinstance(entity_id, list) and entity_id and all(isinstance(v, str) and v.strip() for v in entity_id):
        return entity_id
    raise ValueError('"entity_id" must be a non-empty string or list of strings')


def handle(payload: dict[str, Any], client: HomeAssistantClient) -> dict:
    state = payload.get('state', 'on')
    if state not in {'on', 'off', 'toggle'}:
        raise ValueError('"state" must be one of: on, off, toggle')

    service = {
        'on': 'turn_on',
        'off': 'turn_off',
        'toggle': 'toggle',
    }[state]

    body: dict[str, Any] = {'entity_id': _entity_id(payload)}

    for key in ('brightness', 'rgb_color', 'color_temp', 'transition'):
        if key in payload:
            body[key] = payload[key]

    result = client.post(f'/api/services/light/{service}', body)
    return {'result': result}
