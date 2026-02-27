import json
import os
import subprocess
import sys
from pathlib import Path


CLI_PATH = Path(__file__).resolve().parents[1] / 'ha_cli.py'


def run_cli(command: str, payload: dict, env: dict | None = None):
    process_env = os.environ.copy()
    if env:
        process_env.update(env)

    return subprocess.run(
        [sys.executable, str(CLI_PATH), command, '--json', json.dumps(payload)],
        check=False,
        capture_output=True,
        text=True,
        env=process_env,
    )


def run_cli_json(command: str, payload: dict, env: dict | None = None):
    result = run_cli(command, payload, env=env)
    return result, json.loads(result.stdout)
