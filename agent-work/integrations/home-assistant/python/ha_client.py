import json
import urllib.error
import urllib.request
from typing import Any

from config import HomeAssistantConfig


class HomeAssistantApiError(Exception):
    """Raised for Home Assistant API failures."""


def _parse_response_body(raw: bytes) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw.decode('utf-8'))
    except json.JSONDecodeError:
        return raw.decode('utf-8', errors='replace')


class HomeAssistantClient:
    def __init__(self, config: HomeAssistantConfig):
        self._base_url = config.base_url
        self._access_token = config.access_token

    def _request(self, method: str, path: str, body: dict[str, Any] | None = None) -> Any:
        url = f'{self._base_url}{path}'
        request_data = None if body is None else json.dumps(body).encode('utf-8')
        request = urllib.request.Request(
            url=url,
            data=request_data,
            method=method,
            headers={
                'Authorization': f'Bearer {self._access_token}',
                'Content-Type': 'application/json',
            },
        )

        try:
            with urllib.request.urlopen(request) as response:
                return _parse_response_body(response.read())
        except urllib.error.HTTPError as exc:
            details = _parse_response_body(exc.read())
            raise HomeAssistantApiError(f'Home Assistant API error ({exc.code}): {details}') from exc
        except urllib.error.URLError as exc:
            raise HomeAssistantApiError(f'Unable to reach Home Assistant: {exc.reason}') from exc

    def get(self, path: str) -> Any:
        return self._request('GET', path)

    def post(self, path: str, body: dict[str, Any] | None = None) -> Any:
        return self._request('POST', path, body)
