#!/usr/bin/env python3
import argparse
import json
import sys
import uuid
from typing import Any, Callable

from commands import health, service
from config import ConfigError, load_config
from ha_client import HomeAssistantApiError, HomeAssistantClient

CommandHandler = Callable[[dict[str, Any], HomeAssistantClient], dict[str, Any]]

COMMANDS: dict[str, CommandHandler] = {
    'health.check': health.handle,
    'service.call': service.handle,
}


def error_envelope(command: str, request_id: str, code: str, message: str) -> dict[str, Any]:
    return {
        'ok': False,
        'request_id': request_id,
        'command': command,
        'error': {
            'code': code,
            'message': message,
        },
    }


def success_envelope(command: str, request_id: str, data: dict[str, Any]) -> dict[str, Any]:
    return {
        'ok': True,
        'request_id': request_id,
        'command': command,
        'data': data,
    }


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('command')
    parser.add_argument('--json', dest='payload_json', default='{}')

    args = parser.parse_args()
    request_id = str(uuid.uuid4())

    try:
        payload = json.loads(args.payload_json)
    except json.JSONDecodeError:
        response = error_envelope(
            args.command,
            request_id,
            'VALIDATION_ERROR',
            'Invalid JSON payload supplied in --json',
        )
        print(json.dumps(response))
        return 2

    if not isinstance(payload, dict):
        response = error_envelope(
            args.command,
            request_id,
            'VALIDATION_ERROR',
            'Payload must be a JSON object',
        )
        print(json.dumps(response))
        return 2

    command_handler = COMMANDS.get(args.command)
    if command_handler is None:
        response = error_envelope(
            args.command,
            request_id,
            'VALIDATION_ERROR',
            f'Unknown command: {args.command}',
        )
        print(json.dumps(response))
        return 2

    try:
        config = load_config()
        client = HomeAssistantClient(config)
        data = command_handler(payload, client)
        print(json.dumps(success_envelope(args.command, request_id, data)))
        return 0
    except (ConfigError, ValueError) as exc:
        response = error_envelope(args.command, request_id, 'VALIDATION_ERROR', str(exc))
        print(json.dumps(response))
        return 2
    except HomeAssistantApiError as exc:
        response = error_envelope(args.command, request_id, 'HOME_ASSISTANT_ERROR', str(exc))
        print(json.dumps(response))
        return 5
    except Exception as exc:  # pragma: no cover - defensive fallback
        response = error_envelope(args.command, request_id, 'INTERNAL_ERROR', str(exc))
        print(json.dumps(response))
        return 10


if __name__ == '__main__':
    sys.exit(main())
