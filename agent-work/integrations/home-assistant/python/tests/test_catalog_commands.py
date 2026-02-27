import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from conftest import run_cli_json


class CatalogFakeHaHandler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def _write_json(self, status: int, payload: object):
        data = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == '/api/states':
            self._write_json(
                200,
                [
                    {
                        'entity_id': 'light.living_room_mood',
                        'state': 'on',
                        'attributes': {'friendly_name': 'Living Room Mood Lamp'},
                    },
                    {
                        'entity_id': 'light.kitchen_main',
                        'state': 'off',
                        'attributes': {'friendly_name': 'Kitchen Main Light'},
                    },
                    {
                        'entity_id': 'switch.coffee_maker',
                        'state': 'off',
                        'attributes': {'friendly_name': 'Coffee Maker'},
                    },
                ],
            )
            return

        self._write_json(404, {'message': 'not found'})

    def log_message(self, format, *args):
        return


def _start_server():
    server = HTTPServer(('127.0.0.1', 0), CatalogFakeHaHandler)
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


def test_catalog_refresh_and_get(tmp_path):
    server = _start_server()
    try:
        config_path = _write_config(tmp_path, f'http://127.0.0.1:{server.server_port}')
        catalog_path = tmp_path / 'home-assistant-catalog.json'
        env = {'HA_CONFIG': str(config_path), 'HA_CATALOG_PATH': str(catalog_path)}

        refresh_result, refresh_payload = run_cli_json('catalog.refresh', {}, env=env)
        assert refresh_result.returncode == 0
        assert refresh_payload['ok'] is True
        assert refresh_payload['data']['summary']['entity_count'] == 3

        get_result, get_payload = run_cli_json('catalog.get', {}, env=env)
        assert get_result.returncode == 0
        assert get_payload['ok'] is True
        assert get_payload['data']['catalog']['summary']['entity_count'] == 3
    finally:
        server.shutdown()


def test_catalog_find_by_query(tmp_path):
    server = _start_server()
    try:
        config_path = _write_config(tmp_path, f'http://127.0.0.1:{server.server_port}')
        catalog_path = tmp_path / 'home-assistant-catalog.json'
        env = {'HA_CONFIG': str(config_path), 'HA_CATALOG_PATH': str(catalog_path)}

        run_cli_json('catalog.refresh', {}, env=env)

        find_result, find_payload = run_cli_json(
            'catalog.find',
            {'query': 'living room', 'limit': 10},
            env=env,
        )
        assert find_result.returncode == 0
        assert find_payload['ok'] is True
        assert find_payload['data']['matches'][0]['entity_id'] == 'light.living_room_mood'
    finally:
        server.shutdown()
