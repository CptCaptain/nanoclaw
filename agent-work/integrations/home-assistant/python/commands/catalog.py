from typing import Any

import catalog as catalog_store
from ha_client import HomeAssistantClient


def _require_query(payload: dict[str, Any]) -> str:
    query = payload.get('query')
    if not isinstance(query, str) or not query.strip():
        raise ValueError('"query" must be a non-empty string')
    return query.strip().lower()


def handle_refresh(_payload: dict[str, Any], client: HomeAssistantClient) -> dict[str, Any]:
    states = client.get('/api/states')
    if not isinstance(states, list):
        raise ValueError('Unexpected /api/states response from Home Assistant')

    catalog = catalog_store.build_catalog(states)
    saved_path = catalog_store.save_catalog(catalog)
    return {
        'summary': catalog['summary'],
        'generated_at': catalog['generated_at'],
        'catalog_path': str(saved_path),
    }


def handle_get(_payload: dict[str, Any], _client: HomeAssistantClient) -> dict[str, Any]:
    catalog = catalog_store.load_catalog()
    return {'catalog': catalog}


def handle_find(payload: dict[str, Any], _client: HomeAssistantClient) -> dict[str, Any]:
    query = _require_query(payload)
    limit = payload.get('limit', 20)
    if not isinstance(limit, int) or limit <= 0:
        raise ValueError('"limit" must be a positive integer when provided')

    catalog = catalog_store.load_catalog()
    entities = catalog.get('entities', [])
    if not isinstance(entities, list):
        raise ValueError('Catalog entities are invalid')

    matches = []
    for entity in entities:
        if not isinstance(entity, dict):
            continue
        entity_id = str(entity.get('entity_id', ''))
        domain = str(entity.get('domain', ''))
        friendly_name = str(entity.get('friendly_name', ''))
        haystack = f'{entity_id} {domain} {friendly_name}'.lower()
        if query in haystack:
            matches.append(entity)

    return {
        'matches': matches[:limit],
        'count': len(matches),
    }
