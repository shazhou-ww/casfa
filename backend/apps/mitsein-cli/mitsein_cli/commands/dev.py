"""Mitsein CLI — dev commands (token, health, openapi)."""

from __future__ import annotations

import typer

from ..core.client import ApiClient
from ..core.credentials import resolve_credentials
from ..core.errors import handle_errors
from ..core.output import emit

dev_app = typer.Typer(name="dev", help="Development utilities", no_args_is_help=True)


@dev_app.command()
@handle_errors
def token(
    real: bool = typer.Option(False, "--real", help="Use real account (not e2e test account)"),
    endpoint: str | None = typer.Option(None, "--endpoint", envvar="MITSEIN_API_URL", help="API endpoint"),
    ctx: typer.Context = typer.Option(None),  # noqa: ARG001
) -> None:
    """Print the dev token (wraps scripts/dev-token.sh)."""
    if real:
        import sys
        print("⚠️  Using --real: this token accesses real data, not e2e sandbox.", file=sys.stderr)

    creds = resolve_credentials(endpoint=endpoint, real=real)
    emit(creds.token)


@dev_app.command()
@handle_errors
def health(
    endpoint: str | None = typer.Option(None, "--endpoint", envvar="MITSEIN_API_URL", help="API endpoint"),
    token: str | None = typer.Option(None, "--token", envvar="MITSEIN_TOKEN", help="Bearer token"),
    debug: bool = typer.Option(False, "--debug", help="Print HTTP details"),
    json_output: bool = typer.Option(False, "--json", help="Output as JSON"),
) -> None:
    """Check backend health (GET /api/health)."""
    from ..core.output import set_json_mode
    set_json_mode(json_output)

    client = ApiClient.from_options(token=token, endpoint=endpoint, debug=debug)
    result = client.get("/api/health")
    emit(result, human_formatter=_health_human)


def _health_human(console: "rich.console.Console", data: dict) -> None:
    """Pretty-print health response."""
    ok = data.get("ok", False)
    if ok:
        console.print("[bold green]✓[/bold green] Backend is healthy")
    else:
        console.print("[bold red]✗[/bold red] Backend is unhealthy")
