from typing import Any

import catalog as catalog_store
import memory as memory_store
from ha_client import HomeAssistantClient

RECENT_CHANGES_SECTION = 'Recent Home Changes (from -> to)'
OPEN_QUESTIONS_SECTION = 'Open Questions'


def _entity_map(catalog: dict[str, Any]) -> dict[str, dict[str, Any]]:
    entities = catalog.get('entities', [])
    if not isinstance(entities, list):
        return {}

    result: dict[str, dict[str, Any]] = {}
    for entity in entities:
        if not isinstance(entity, dict):
            continue
        entity_id = entity.get('entity_id')
        if isinstance(entity_id, str) and entity_id:
            result[entity_id] = entity
    return result


def _diff_catalog(old_catalog: dict[str, Any], new_catalog: dict[str, Any]) -> dict[str, Any]:
    old_entities = _entity_map(old_catalog)
    new_entities = _entity_map(new_catalog)

    old_ids = set(old_entities)
    new_ids = set(new_entities)

    added = sorted(new_ids - old_ids)
    removed = sorted(old_ids - new_ids)

    renamed: list[tuple[str, str, str]] = []
    area_moved: list[tuple[str, str, str]] = []

    for entity_id in sorted(old_ids & new_ids):
        old_entity = old_entities[entity_id]
        new_entity = new_entities[entity_id]

        old_name = str(old_entity.get('friendly_name', entity_id))
        new_name = str(new_entity.get('friendly_name', entity_id))
        if old_name != new_name:
            renamed.append((entity_id, old_name, new_name))

        old_area = str(old_entity.get('attributes', {}).get('area_id', ''))
        new_area = str(new_entity.get('attributes', {}).get('area_id', ''))
        if old_area != new_area and (old_area or new_area):
            area_moved.append((entity_id, old_area or 'unknown', new_area or 'unknown'))

    return {
        'added': added,
        'removed': removed,
        'renamed': renamed,
        'area_moved': area_moved,
    }


def handle_refresh_and_sync(_payload: dict[str, Any], client: HomeAssistantClient) -> dict[str, Any]:
    try:
        old_catalog = catalog_store.load_catalog()
    except ValueError:
        old_catalog = {'entities': []}

    states = client.get('/api/states')
    if not isinstance(states, list):
        raise ValueError('Unexpected /api/states response from Home Assistant')

    new_catalog = catalog_store.build_catalog(states)
    saved_catalog_path = catalog_store.save_catalog(new_catalog)

    diff = _diff_catalog(old_catalog, new_catalog)

    memory_store.ensure_memory_file()

    for entity_id in diff['added']:
        memory_store.append_note(RECENT_CHANGES_SECTION, f'added: {entity_id}')
    for entity_id in diff['removed']:
        memory_store.append_note(RECENT_CHANGES_SECTION, f'removed: {entity_id}')
        memory_store.append_note(
            OPEN_QUESTIONS_SECTION,
            f'Confirm replacement intent for removed entity {entity_id}.',
        )
    for entity_id, old_name, new_name in diff['renamed']:
        memory_store.append_note(
            RECENT_CHANGES_SECTION,
            f'{entity_id} renamed: {old_name} -> {new_name}',
        )
    for entity_id, old_area, new_area in diff['area_moved']:
        memory_store.append_note(
            RECENT_CHANGES_SECTION,
            f'{entity_id} area change: {old_area} -> {new_area}',
        )
        memory_store.append_note(
            OPEN_QUESTIONS_SECTION,
            f'Confirm intent updates for {entity_id} after area change {old_area} -> {new_area}.',
        )

    return {
        'changes': {
            'added': len(diff['added']),
            'removed': len(diff['removed']),
            'renamed': len(diff['renamed']),
            'area_moved': len(diff['area_moved']),
        },
        'catalog_path': str(saved_catalog_path),
        'memory_path': str(memory_store.memory_path()),
    }
