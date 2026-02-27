from typing import Any


class ConfirmationRequiredError(Exception):
    """Raised when an operation requires explicit confirmation."""


HIGH_IMPACT_SERVICES: set[tuple[str, str]] = {
    ('lock', 'unlock'),
    ('alarm_control_panel', 'alarm_disarm'),
    ('cover', 'open_cover'),
    ('cover', 'open_cover_tilt'),
}


def require_confirmation_if_needed(domain: str, service: str, payload: dict[str, Any]) -> None:
    if (domain, service) not in HIGH_IMPACT_SERVICES:
        return

    confirm_token = payload.get('confirm_token')
    if isinstance(confirm_token, str) and confirm_token.strip():
        return

    raise ConfirmationRequiredError(
        f'Confirmation required before calling {domain}.{service}. Include confirm_token to proceed.'
    )
