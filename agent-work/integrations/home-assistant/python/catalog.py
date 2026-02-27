import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def catalog_path() -> Path:
    custom_path = os.environ.get('HA_CATALOG_PATH')
    if custom_path:
        return Path(custom_path)
    return Path.cwd() / 'home-assistant-catalog.json'


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_catalog(states: list[dict[str, Any]]) -> dict[str, Any]:
    entities: list[dict[str, Any]] = []
    domains: dict[str, int] = {}

    for item in states:
        entity_id = item.get('entity_id', '')
        if not isinstance(entity_id, str) or '.' not in entity_id:
            continue

        domain = entity_id.split('.', 1)[0]
        domains[domain] = domains.get(domain, 0) + 1

        attributes = item.get('attributes') if isinstance(item.get('attributes'), dict) else {}
        entities.append(
            {
                'entity_id': entity_id,
                'domain': domain,
                'state': item.get('state'),
                'friendly_name': attributes.get('friendly_name') or entity_id,
                'attributes': attributes,
            }
        )

    return {
        'generated_at': _timestamp(),
        'entities': entities,
        'summary': {
            'entity_count': len(entities),
            'domains': domains,
        },
    }


def save_catalog(catalog: dict[str, Any]) -> Path:
    path = catalog_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(catalog, indent=2) + '\n', encoding='utf-8')
    return path


def load_catalog() -> dict[str, Any]:
    path = catalog_path()
    if not path.exists():
        raise ValueError(f'Catalog file not found: {path}')

    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except json.JSONDecodeError as exc:
        raise ValueError(f'Catalog file is invalid JSON: {path}') from exc
