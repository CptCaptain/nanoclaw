from typing import Any

import memory
from ha_client import HomeAssistantClient


def _require_text(payload: dict[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f'"{key}" must be a non-empty string')
    return value.strip()


def handle_read(_payload: dict[str, Any], _client: HomeAssistantClient | None) -> dict:
    path = memory.ensure_memory_file()
    content = memory.read_memory()
    return {'memory_path': str(path), 'content': content}


def handle_append_note(payload: dict[str, Any], _client: HomeAssistantClient | None) -> dict:
    section = _require_text(payload, 'section')
    note = _require_text(payload, 'note')
    content = memory.append_note(section, note)
    return {'memory_path': str(memory.memory_path()), 'content': content}


def handle_replace_section(payload: dict[str, Any], _client: HomeAssistantClient | None) -> dict:
    section = _require_text(payload, 'section')
    content_value = payload.get('content')
    if not isinstance(content_value, str):
        raise ValueError('"content" must be a string')

    content = memory.replace_section(section, content_value)
    return {'memory_path': str(memory.memory_path()), 'content': content}
