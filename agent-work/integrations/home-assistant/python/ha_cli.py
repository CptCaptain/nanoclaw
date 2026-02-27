#!/usr/bin/env python3
import argparse
import json
import sys
import uuid
from typing import Any


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


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('command')
    parser.add_argument('--json', dest='payload_json', default='{}')

    args = parser.parse_args()
    request_id = str(uuid.uuid4())

    try:
        json.loads(args.payload_json)
    except json.JSONDecodeError:
        payload = error_envelope(
            args.command,
            request_id,
            'VALIDATION_ERROR',
            'Invalid JSON payload supplied in --json',
        )
        print(json.dumps(payload))
        return 2

    payload = error_envelope(
        args.command,
        request_id,
        'VALIDATION_ERROR',
        f'Unknown command: {args.command}',
    )
    print(json.dumps(payload))
    return 2


if __name__ == '__main__':
    sys.exit(main())
