import json
import subprocess
import sys
from pathlib import Path


CLI_PATH = Path(__file__).resolve().parents[1] / 'ha_cli.py'


def run_cli(command: str, payload: dict):
    return subprocess.run(
        [sys.executable, str(CLI_PATH), command, '--json', json.dumps(payload)],
        check=False,
        capture_output=True,
        text=True,
    )
