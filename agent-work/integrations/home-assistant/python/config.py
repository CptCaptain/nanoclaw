import json
import os
from dataclasses import dataclass
from pathlib import Path


class ConfigError(Exception):
    """Raised when CLI configuration is missing or invalid."""


@dataclass(frozen=True)
class HomeAssistantConfig:
    base_url: str
    access_token: str


def _default_config_path() -> Path:
    return Path.home() / '.config' / 'home-assistant' / 'config.json'


def load_config() -> HomeAssistantConfig:
    config_path = Path(os.environ.get('HA_CONFIG', _default_config_path()))

    if not config_path.exists():
        raise ConfigError(f'Config file not found: {config_path}')

    try:
        raw = json.loads(config_path.read_text(encoding='utf-8'))
    except json.JSONDecodeError as exc:
        raise ConfigError(f'Invalid JSON in config file: {config_path}') from exc

    base_url = raw.get('baseUrl')
    access_token = raw.get('accessToken')

    if not isinstance(base_url, str) or not base_url.strip():
        raise ConfigError('Config key "baseUrl" must be a non-empty string')
    if not isinstance(access_token, str) or not access_token.strip():
        raise ConfigError('Config key "accessToken" must be a non-empty string')

    return HomeAssistantConfig(base_url=base_url.rstrip('/'), access_token=access_token)
