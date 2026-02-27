import json

from conftest import run_cli


def test_unknown_command_returns_validation_error_envelope():
    result = run_cli('unknown.command', {})

    assert result.returncode == 2

    payload = json.loads(result.stdout)
    assert payload['ok'] is False
    assert payload['command'] == 'unknown.command'
    assert isinstance(payload['request_id'], str)
    assert payload['error']['code'] == 'VALIDATION_ERROR'
