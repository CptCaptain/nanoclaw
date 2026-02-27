from ha_client import HomeAssistantClient


def _require_text(payload: dict, key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f'"{key}" must be a non-empty string')
    return value


def handle(payload: dict, client: HomeAssistantClient) -> dict:
    domain = _require_text(payload, 'domain')
    service = _require_text(payload, 'service')

    target = payload.get('target', {})
    data = payload.get('data', {})

    if target is None:
        target = {}
    if data is None:
        data = {}

    if not isinstance(target, dict):
        raise ValueError('"target" must be an object when provided')
    if not isinstance(data, dict):
        raise ValueError('"data" must be an object when provided')

    body = {**target, **data}
    result = client.post(f'/api/services/{domain}/{service}', body if body else None)

    return {'result': result}
