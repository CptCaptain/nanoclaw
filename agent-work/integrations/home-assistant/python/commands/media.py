from typing import Any

from ha_client import HomeAssistantClient


_ACTION_TO_SERVICE = {
    'play': 'media_play',
    'pause': 'media_pause',
    'stop': 'media_stop',
    'next': 'media_next_track',
    'previous': 'media_previous_track',
    'volume_set': 'volume_set',
}


def handle(payload: dict[str, Any], client: HomeAssistantClient) -> dict:
    entity_id = payload.get('entity_id')
    if not isinstance(entity_id, str) or not entity_id.strip():
        raise ValueError('"entity_id" must be a non-empty string')

    action = payload.get('action')
    if action not in _ACTION_TO_SERVICE:
        raise ValueError('"action" must be one of: play, pause, stop, next, previous, volume_set')

    body: dict[str, Any] = {'entity_id': entity_id}
    if action == 'volume_set':
        if 'volume_level' not in payload:
            raise ValueError('"volume_level" is required when action=volume_set')
        body['volume_level'] = payload['volume_level']

    result = client.post(f'/api/services/media_player/{_ACTION_TO_SERVICE[action]}', body)
    return {'result': result}
