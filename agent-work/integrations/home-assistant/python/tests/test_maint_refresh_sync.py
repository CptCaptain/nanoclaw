import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from conftest import run_cli_json


class MaintFakeHaHandler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    states = [
        {
            'entity_id': 'light.corner_lamp',
            'state': 'off',
            'attributes': {'friendly_name': 'Corner Lamp'},
        }
    ]

    def _write_json(self, status: int, payload: object):
        data = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == '/api/states':
            self._write_json(200, self.states)
            return
        self._write_json(404, {'message': 'not found'})

    def log_message(self, format, *args):
        return


def _start_server():
    server = HTTPServer(('127.0.0.1', 0), MaintFakeHaHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def _write_config(tmp_path: Path, base_url: str) -> Path:
    config_path = tmp_path / 'ha-config.json'
    config_path.write_text(
        json.dumps({'baseUrl': base_url, 'accessToken': 'test-token'}),
        encoding='utf-8',
    )
    return config_path


def test_maint_refresh_and_sync_updates_catalog_and_memory(tmp_path):
    server = _start_server()
    try:
        config_path = _write_config(tmp_path, f'http://127.0.0.1:{server.server_port}')
        catalog_path = tmp_path / 'home-assistant-catalog.json'
        memory_path = tmp_path / 'home-assistant-memory.md'
        env = {
            'HA_CONFIG': str(config_path),
            'HA_CATALOG_PATH': str(catalog_path),
            'HA_MEMORY_PATH': str(memory_path),
        }

        run_cli_json('maint.refresh_and_sync', {}, env=env)

        MaintFakeHaHandler.states = [
            {
                'entity_id': 'light.living_room_mood_lamp',
                'state': 'off',
                'attributes': {'friendly_name': 'Living Room Mood Lamp'},
            }
        ]

        result, payload = run_cli_json('maint.refresh_and_sync', {}, env=env)

        assert result.returncode == 0
        assert payload['ok'] is True
        assert payload['data']['changes']['added'] >= 1
        assert payload['data']['changes']['removed'] >= 1

        memory_text = memory_path.read_text(encoding='utf-8')
        assert 'light.corner_lamp' in memory_text
        assert 'light.living_room_mood_lamp' in memory_text
    finally:
        server.shutdown()
