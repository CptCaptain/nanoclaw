import os
from pathlib import Path


DEFAULT_MEMORY_CONTENT = """# Home Assistant Memory

## Interpretation Guidelines
- Add clarified preference mappings here.

## Room Preferences
- Add room-specific defaults here.

## Time/Context Behaviors
- Add context-aware behavior notes here.

## Safety Preferences
- High-impact actions require explicit confirmation.

## Recent Home Changes (from -> to)
- Add catalog drift updates here.

## Open Questions
- Add unresolved interpretation questions here.
"""


def memory_path() -> Path:
    custom_path = os.environ.get('HA_MEMORY_PATH')
    if custom_path:
        return Path(custom_path)
    return Path.cwd() / 'home-assistant-memory.md'


def ensure_memory_file() -> Path:
    path = memory_path()
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(DEFAULT_MEMORY_CONTENT, encoding='utf-8')
    return path


def read_memory() -> str:
    path = ensure_memory_file()
    return path.read_text(encoding='utf-8')


def _section_bounds(lines: list[str], section: str) -> tuple[int, int]:
    heading = f'## {section}'
    start = -1

    for idx, line in enumerate(lines):
        if line.strip() == heading:
            start = idx + 1
            break

    if start == -1:
        raise ValueError(f'Section not found: {section}')

    end = len(lines)
    for idx in range(start, len(lines)):
        if lines[idx].startswith('## '):
            end = idx
            break

    return start, end


def append_note(section: str, note: str) -> str:
    if not note.strip():
        raise ValueError('"note" must be a non-empty string')

    path = ensure_memory_file()
    lines = path.read_text(encoding='utf-8').splitlines()
    start, end = _section_bounds(lines, section)

    bullet = f'- {note.strip()}'
    section_lines = lines[start:end]
    if bullet in section_lines:
        return path.read_text(encoding='utf-8')

    insert_at = end
    while insert_at > start and lines[insert_at - 1].strip() == '':
        insert_at -= 1

    lines.insert(insert_at, bullet)
    updated = '\n'.join(lines).rstrip() + '\n'
    path.write_text(updated, encoding='utf-8')
    return updated


def replace_section(section: str, content: str) -> str:
    path = ensure_memory_file()
    lines = path.read_text(encoding='utf-8').splitlines()
    start, end = _section_bounds(lines, section)

    replacement_lines = [line.rstrip() for line in content.strip().splitlines()] if content.strip() else []

    new_lines = lines[:start] + replacement_lines + [''] + lines[end:]
    updated = '\n'.join(new_lines).rstrip() + '\n'
    path.write_text(updated, encoding='utf-8')
    return updated
