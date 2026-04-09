"""Mitsein CLI — root application."""

from __future__ import annotations

import typer

from .commands import dev_app
from .commands.version import version_command

app = typer.Typer(
    name="mitsein",
    help="Mitsein CLI — internal dev tool for agent verification and workflow automation.",
    no_args_is_help=True,
)

# Register sub-apps
app.add_typer(dev_app)

# Register top-level commands
app.command(name="version")(version_command)


# Global callback for shared flags
@app.callback()
def main(
    ctx: typer.Context,
    endpoint: str | None = typer.Option(None, "--endpoint", envvar="MITSEIN_API_URL", help="API endpoint URL"),
    token: str | None = typer.Option(None, "--token", envvar="MITSEIN_TOKEN", help="Bearer token"),
    profile: str = typer.Option("e2e", "--profile", help="Profile name"),
    real: bool = typer.Option(False, "--real", help="Use real account for dev token"),
    json_output: bool = typer.Option(False, "--json", help="Output structured JSON"),
    debug: bool = typer.Option(False, "--debug", help="Print HTTP request/response details"),
    timeout: float = typer.Option(30.0, "--timeout", help="HTTP timeout in seconds"),
) -> None:
    """Global flags shared by all commands."""
    from .core.output import set_json_mode
    set_json_mode(json_output)

    # Store global options in context for sub-commands
    ctx.ensure_object(dict)
    ctx.obj["endpoint"] = endpoint
    ctx.obj["token"] = token
    ctx.obj["profile"] = profile
    ctx.obj["real"] = real
    ctx.obj["json"] = json_output
    ctx.obj["debug"] = debug
    ctx.obj["timeout"] = timeout
