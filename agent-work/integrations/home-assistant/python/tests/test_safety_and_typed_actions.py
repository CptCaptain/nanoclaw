import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from conftest import run_cli_json


class SafetyFakeHaHandler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def _write_json(self, status: int, payload: object):
        data = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if self.path == '/api/services/light/turn_on':
            content_length = int(self.headers.get('Content-Length', '0'))
            body = json.loads(self.rfile.read(content_length) or b'{}')
            self._write_json(200, [{'received': body}])
            return

        self._write_json(404, {'message': 'not found'})

    def log_message(self, format, *args):
        return


def _start_server():
    server = HTTPServer(('127.0.0.1', 0), SafetyFakeHaHandler)
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


def test_light_set_turns_on_entity(tmp_path):
    server = _start_server()
    try:
        config_path = _write_config(tmp_path, f'http://127.0.0.1:{server.server_port}')
        env = {'HA_CONFIG': str(config_path)}

        result, payload = run_cli_json(
            'light.set',
            {'entity_id': ['light.living_room_mood'], 'state': 'on', 'brightness': 100},
            env=env,
        )

        assert result.returncode == 0
        assert payload['ok'] is True
        assert payload['data']['result'][0]['received'] == {
            'entity_id': ['light.living_room_mood'],
            'brightness': 100,
        }
    finally:
        server.shutdown()


def test_high_impact_service_requires_confirmation(tmp_path):
    server = _start_server()
    try:
        config_path = _write_config(tmp_path, f'http://127.0.0.1:{server.server_port}')
        env = {'HA_CONFIG': str(config_path)}

        result, payload = run_cli_json(
            'service.call',
            {
                'domain': 'lock',
                'service': 'unlock',
                'target': {'entity_id': ['lock.front_door']},
            },
            env=env,
        )

        assert result.returncode == 4
        assert payload['ok'] is False
        assert payload['error']['code'] == 'CONFIRMATION_REQUIRED'
    finally:
        server.shutdown()
