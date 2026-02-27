from pathlib import Path

from conftest import run_cli_json


def test_memory_read_bootstraps_default_file(tmp_path):
    memory_path = tmp_path / 'home-assistant-memory.md'
    env = {'HA_MEMORY_PATH': str(memory_path)}

    result, payload = run_cli_json('memory.read', {}, env=env)

    assert result.returncode == 0
    assert payload['ok'] is True
    assert '# Home Assistant Memory' in payload['data']['content']
    assert memory_path.exists()


def test_memory_append_note_updates_section(tmp_path):
    memory_path = tmp_path / 'home-assistant-memory.md'
    env = {'HA_MEMORY_PATH': str(memory_path)}

    run_cli_json('memory.read', {}, env=env)
    result, payload = run_cli_json(
        'memory.append_note',
        {
            'section': 'Recent Home Changes (from -> to)',
            'note': 'light.corner_lamp -> light.living_room_mood_lamp',
        },
        env=env,
    )

    assert result.returncode == 0
    assert payload['ok'] is True
    assert 'light.corner_lamp -> light.living_room_mood_lamp' in memory_path.read_text(encoding='utf-8')


def test_memory_replace_section_overwrites_section_content(tmp_path):
    memory_path = tmp_path / 'home-assistant-memory.md'
    env = {'HA_MEMORY_PATH': str(memory_path)}

    run_cli_json('memory.read', {}, env=env)
    result, payload = run_cli_json(
        'memory.replace_section',
        {
            'section': 'Interpretation Guidelines',
            'content': '- Evening living room lights means mood lamp only.',
        },
        env=env,
    )

    assert result.returncode == 0
    assert payload['ok'] is True

    text = memory_path.read_text(encoding='utf-8')
    assert 'Evening living room lights means mood lamp only.' in text
