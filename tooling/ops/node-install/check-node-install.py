#!/usr/bin/env python3
"""Post-install check for Tono node-side components. Read-only; sends nothing.

A node operator runs this as root after installing (or updating) any of:

  relay-probe     A5  API relay end-to-end probe (tooling/ops/relay/relay-probe.py,
                      tono-relay-probe.service / .timer, docs/ops/api-relay.md)
  relay-logrotate A7  relay log rotation (/etc/logrotate.d/00-tono-relay) and the
                      relay nginx config it reopens (nginx -t)
  node-agent      A20 node self-registration heartbeat (services/node-agent/)

  python3 -I check-node-install.py relay-probe relay-logrotate node-agent

Per component it checks that the installed files are present with the owner
and mode the install steps give them, that the systemd units are installed,
the timer enabled and active and the last run did not fail, that the config
parses (the node agent's own allow-list parser), that credential files are
root-owned 0600, and runs a local smoke test that sends nothing to the control
plane:

  relay-probe     one probe through 127.0.0.1:2053 with default certificate
                  verification, using the installed script's own probe();
                  the result is printed and NOT reported.
  relay-logrotate nginx -t and logrotate -d /etc/logrotate.conf.
  node-agent      loads the config, validates the token's shape and detects
                  the roles a heartbeat would report; no heartbeat is sent.

Secrets: no output line carries a credential value, a config value, file
contents or exception text. Credential files are judged by owner, mode, the
presence of key names and the token's shape; failures name the check only.

Exit: 0 every check passed (warnings allowed), 1 any check failed, 2 usage.

--root PREFIX and --expect-uid exist for the stub tests
(test_check_node_install.py); on a node, use neither.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import re
import shutil
import stat
import subprocess
import sys
from pathlib import Path

COMPONENTS = ("relay-probe", "relay-logrotate", "node-agent")
CHILD_ENV = {"PATH": os.environ.get("PATH", "/usr/sbin:/usr/bin:/sbin:/bin"), "LANG": "C"}

RELAY_PROBE_SCRIPT = "/opt/tono-relay-probe/relay-probe.py"
RELAY_PROBE_UNIT = "tono-relay-probe"
EXIT_AGENT_ENV = "/etc/tono-exit-agent/env"
RELAY_STREAM_CONF = "/etc/nginx/tono-relay.stream.conf"
RELAY_LOGROTATE = "/etc/logrotate.d/00-tono-relay"
LOGROTATE_CONF = "/etc/logrotate.conf"
NODE_AGENT_SCRIPT = "/opt/tono-node-agent/tono_node_agent.py"
NODE_AGENT_CONF = "/etc/tono/node-agent.conf"
NODE_AGENT_TOKEN = "/etc/tono/node-agent.token"
NODE_AGENT_UNIT = "tono-node-agent"
SYSTEMD_DIR = "/etc/systemd/system"


class Report:
    def __init__(self) -> None:
        self.failed = 0

    def line(self, level: str, component: str, text: str) -> None:
        print(f"{level:4} {component}: {text}")
        if level == "FAIL":
            self.failed += 1

    def ok(self, component: str, text: str) -> None:
        self.line("PASS", component, text)

    def fail(self, component: str, text: str) -> None:
        self.line("FAIL", component, text)

    def warn(self, component: str, text: str) -> None:
        self.line("WARN", component, text)


class Node:
    """Filesystem and command access, rooted at --root for the stub tests."""

    def __init__(self, root: str, uid: int, gid: int) -> None:
        self.root = Path(root)
        self.uid = uid
        self.gid = gid

    def path(self, absolute: str) -> Path:
        return self.root / absolute.lstrip("/")

    def run(self, *argv: str) -> tuple[int, str]:
        """Exit code and combined output; never raises. Output is for parsing only."""
        exe = shutil.which(argv[0], path=CHILD_ENV["PATH"])
        if exe is None:
            return 127, ""
        try:
            done = subprocess.run(
                [exe, *argv[1:]],
                check=False,
                timeout=60,
                env=CHILD_ENV,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                errors="replace",
            )
        except (OSError, subprocess.SubprocessError):
            return 126, ""
        return done.returncode, done.stdout


def check_file(node: Node, report: Report, component: str, absolute: str, mode: int) -> bool:
    """Present, a regular file, owned by root:root, exactly `mode`, parent not writable by others."""
    path = node.path(absolute)
    try:
        info = path.lstat()
    except OSError:
        report.fail(component, f"{absolute} missing")
        return False
    problems = []
    if not stat.S_ISREG(info.st_mode):
        problems.append("not a regular file")
    if info.st_uid != node.uid or info.st_gid != node.gid:
        problems.append("owner is not root:root")
    if stat.S_IMODE(info.st_mode) != mode:
        problems.append(f"mode {stat.S_IMODE(info.st_mode):04o}, want {mode:04o}")
    try:
        parent = path.parent.stat()
        if parent.st_uid != node.uid or stat.S_IMODE(parent.st_mode) & 0o022:
            problems.append("parent directory is not root-owned or is group/world-writable")
    except OSError:
        problems.append("parent directory unreadable")
    if problems:
        report.fail(component, f"{absolute}: {'; '.join(problems)}")
        return False
    report.ok(component, f"{absolute} root:root {mode:04o}")
    return True


def check_unit_text(node: Node, report: Report, component: str, unit_file: str,
                    required: list[str]) -> None:
    try:
        text = node.path(unit_file).read_text(errors="replace")
    except OSError:
        return  # check_file already failed it
    lines = {line.strip() for line in text.splitlines()}
    missing = [needle for needle in required if needle not in lines]
    if missing:
        report.fail(component, f"{unit_file} lacks {', '.join(missing)}")
    else:
        report.ok(component, f"{unit_file} has {', '.join(required)}")


def check_timer(node: Node, report: Report, component: str, unit: str) -> None:
    code, out = node.run("systemctl", "is-enabled", f"{unit}.timer")
    state = out.strip().splitlines()[-1] if out.strip() else ""
    if code == 0 and state == "enabled":
        report.ok(component, f"{unit}.timer enabled")
    else:
        report.fail(component, f"{unit}.timer not enabled ({state[:40] or 'no answer'})")
    code, out = node.run("systemctl", "is-active", f"{unit}.timer")
    state = out.strip().splitlines()[-1] if out.strip() else ""
    if code == 0 and state == "active":
        report.ok(component, f"{unit}.timer active")
    else:
        report.fail(component, f"{unit}.timer not active ({state[:40] or 'no answer'})")
    code, out = node.run("systemctl", "show", "-p", "LoadState", "-p", "Result", f"{unit}.service")
    props = dict(line.partition("=")[::2] for line in out.splitlines() if "=" in line)
    if code != 0 or props.get("LoadState") != "loaded":
        report.fail(component, f"{unit}.service not loaded (run systemctl daemon-reload)")
    elif props.get("Result", "success") != "success":
        report.fail(component, f"{unit}.service last run result {props['Result'][:40]}; "
                               f"see journalctl -u {unit} -n 5")
    else:
        report.ok(component, f"{unit}.service loaded, last result success")


def load_installed(path: Path, name: str):
    """Import an installed, already ownership-checked script without running its main()."""
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def env_keys(text: str) -> dict[str, bool]:
    """KEY -> value non-empty, for KEY=value lines. Values are never kept."""
    keys: dict[str, bool] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key.startswith("export "):
            key = key[len("export "):].strip()
        keys[key] = bool(value.strip().strip("'\""))
    return keys


def check_relay_probe(node: Node, report: Report, smoke: bool) -> None:
    c = "relay-probe"
    script_ok = check_file(node, report, c, RELAY_PROBE_SCRIPT, 0o755)
    for suffix in ("service", "timer"):
        check_file(node, report, c, f"{SYSTEMD_DIR}/{RELAY_PROBE_UNIT}.{suffix}", 0o644)
    check_unit_text(node, report, c, f"{SYSTEMD_DIR}/{RELAY_PROBE_UNIT}.service", [
        f"EnvironmentFile={EXIT_AGENT_ENV}",
        f"ExecStart=/usr/bin/python3 -I {RELAY_PROBE_SCRIPT}",
        "DynamicUser=yes",
    ])
    if check_file(node, report, c, EXIT_AGENT_ENV, 0o600):
        try:
            keys = env_keys(node.path(EXIT_AGENT_ENV).read_text(errors="replace"))
        except OSError as error:
            report.fail(c, f"{EXIT_AGENT_ENV} unreadable ({type(error).__name__})")
        else:
            missing = [k for k in ("TONO_HOME_AGENT_TOKEN", "TONO_API_BASE") if not keys.get(k)]
            if missing:
                report.fail(c, f"{EXIT_AGENT_ENV} does not set {', '.join(missing)}")
            else:
                report.ok(c, f"{EXIT_AGENT_ENV} sets TONO_HOME_AGENT_TOKEN and TONO_API_BASE")
    check_timer(node, report, c, RELAY_PROBE_UNIT)
    if not smoke:
        report.warn(c, "smoke probe skipped (--no-smoke)")
        return
    if not script_ok:
        report.fail(c, "smoke probe not run: the installed script failed its file check")
        return
    try:
        probe = load_installed(node.path(RELAY_PROBE_SCRIPT), "tono_relay_probe_installed")
        result = probe.probe(probe.parse_addr(probe.DEFAULT_ADDR), probe.DEFAULT_HOST)
    except Exception as error:  # noqa: BLE001 - only the class name is printed
        report.fail(c, f"smoke probe could not run ({type(error).__name__})")
        return
    status = result.get("httpStatus")
    latency = result.get("latencyMs")
    error = result.get("error")
    if status == 200 and not error:
        report.ok(c, f"smoke probe through {probe.DEFAULT_ADDR}: HTTP 200 in {latency} ms (not reported)")
    else:
        detail = str(error)[:120] if error else f"HTTP {status}"
        report.fail(c, f"smoke probe through {probe.DEFAULT_ADDR}: {detail} (not reported)")


def version_tuple(text: str) -> tuple[int, ...]:
    match = re.search(r"(\d+)\.(\d+)(?:\.(\d+))?", text)
    if not match:
        return ()
    return tuple(int(part or 0) for part in match.groups())


def check_relay_logrotate(node: Node, report: Report, smoke: bool) -> None:
    c = "relay-logrotate"
    check_file(node, report, c, RELAY_STREAM_CONF, 0o644)
    code, out = node.run("logrotate", "--version")
    have = version_tuple(out.splitlines()[0]) if code == 0 and out else ()
    installed = node.path(RELAY_LOGROTATE).exists()
    if not have:
        report.fail(c, "logrotate is not installed")
    elif have < (3, 21, 0):
        if installed:
            report.fail(c, f"{RELAY_LOGROTATE} present but logrotate {'.'.join(map(str, have))} "
                           "lacks ignoreduplicates (needs 3.21+); remove it")
        else:
            report.warn(c, f"logrotate {'.'.join(map(str, have))} < 3.21: install skipped by design; "
                           "the distro nginx stanza rotates the relay logs")
        return
    if not check_file(node, report, c, RELAY_LOGROTATE, 0o644):
        return
    text = node.path(RELAY_LOGROTATE).read_text(errors="replace")
    directives = {line.strip() for line in text.splitlines()}
    wanted = ["daily", "rotate 14", "dateext", "compress", "ignoreduplicates"]
    missing = [d for d in wanted if d not in directives]
    if missing:
        report.fail(c, f"{RELAY_LOGROTATE} lacks {', '.join(missing)}")
    else:
        report.ok(c, f"{RELAY_LOGROTATE} rotates daily, keeps 14, ignoreduplicates")
    if not smoke:
        report.warn(c, "nginx -t and logrotate -d skipped (--no-smoke)")
        return
    code, out = node.run("nginx", "-t")
    if code == 0:
        report.ok(c, "nginx -t passes")
    else:
        first = next((l for l in out.splitlines() if "emerg" in l or "error" in l.lower()), "")
        report.fail(c, f"nginx -t failed: {first.strip()[:160] or f'exit {code}'}")
    code, out = node.run("logrotate", "-d", str(node.path(LOGROTATE_CONF)))
    errors = [l for l in out.splitlines()
              if l.startswith("error:") and ("00-tono-relay" in l or "tono-relay" in l
                                             or "duplicate log entry" in l)]
    if errors:
        report.fail(c, f"logrotate -d: {errors[0].strip()[:160]}")
    elif "tono-relay.log" not in out:
        report.fail(c, "logrotate -d did not consider /var/log/nginx/tono-relay.log")
    else:
        report.ok(c, "logrotate -d reads the relay stanza without errors or duplicates")


def check_node_agent(node: Node, report: Report, smoke: bool) -> None:
    c = "node-agent"
    script_ok = check_file(node, report, c, NODE_AGENT_SCRIPT, 0o644)
    for suffix in ("service", "timer"):
        check_file(node, report, c, f"{SYSTEMD_DIR}/{NODE_AGENT_UNIT}.{suffix}", 0o644)
    check_unit_text(node, report, c, f"{SYSTEMD_DIR}/{NODE_AGENT_UNIT}.service", [
        f"LoadCredential=node-agent-token:{NODE_AGENT_TOKEN}",
        f"ExecStart=/usr/bin/python3 -I {NODE_AGENT_SCRIPT} --config {NODE_AGENT_CONF}",
        "DynamicUser=yes",
    ])
    conf_ok = check_file(node, report, c, NODE_AGENT_CONF, 0o644)
    token_ok = check_file(node, report, c, NODE_AGENT_TOKEN, 0o600)
    check_timer(node, report, c, NODE_AGENT_UNIT)
    if not script_ok:
        report.fail(c, "config and token not parsed: the installed agent failed its file check")
        return
    try:
        agent = load_installed(node.path(NODE_AGENT_SCRIPT), "tono_node_agent_installed")
    except Exception as error:  # noqa: BLE001
        report.fail(c, f"installed agent does not load ({type(error).__name__})")
        return
    # The agent's own parsers. Their refusals are fixed text without values.
    if conf_ok:
        try:
            config = agent.load_config(node.path(NODE_AGENT_CONF))
            agent.api_base(config["TONO_API_BASE"])
        except agent.Refusal as error:
            report.fail(c, f"{NODE_AGENT_CONF}: {error}")
        except Exception as error:  # noqa: BLE001
            report.fail(c, f"{NODE_AGENT_CONF} not parsed ({type(error).__name__})")
        else:
            report.ok(c, f"{NODE_AGENT_CONF} parses (TONO_API_BASE, TONO_NODE_NAME)")
    if token_ok:
        try:
            agent.read_token(node.path(NODE_AGENT_TOKEN))
        except agent.Refusal as error:
            report.fail(c, f"{NODE_AGENT_TOKEN}: {error}")
        except Exception as error:  # noqa: BLE001
            report.fail(c, f"{NODE_AGENT_TOKEN} not read ({type(error).__name__})")
        else:
            report.ok(c, f"{NODE_AGENT_TOKEN} holds one well-formed tna1 token")
    if not smoke:
        report.warn(c, "role detection skipped (--no-smoke)")
        return
    systemctl = shutil.which("systemctl", path=CHILD_ENV["PATH"])
    if systemctl is None:
        report.fail(c, "systemctl not found; roles not detected")
        return
    agent.SYSTEMCTL = systemctl
    try:
        roles = agent.detect_roles(relay_conf=node.path(RELAY_STREAM_CONF))
    except Exception as error:  # noqa: BLE001
        report.fail(c, f"role detection failed ({type(error).__name__})")
        return
    if roles:
        report.ok(c, f"a heartbeat would report roles {','.join(roles)} (not sent)")
    else:
        report.warn(c, "a heartbeat would report no roles: tono-xray, tono-hy2 and the relay are all down")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check Tono node-side installs (read-only).")
    parser.add_argument("components", nargs="+", choices=COMPONENTS)
    parser.add_argument("--no-smoke", action="store_true", help="skip the local smoke tests")
    parser.add_argument("--root", default="/", help=argparse.SUPPRESS)
    parser.add_argument("--expect-uid", type=int, default=0, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.expect_uid == 0 and os.geteuid() != 0:
        print("run as root: credential files are 0600 root", file=sys.stderr)
        return 2
    gid = 0 if args.expect_uid == 0 else os.getegid()
    node = Node(args.root, args.expect_uid, gid)
    report = Report()
    checks = {
        "relay-probe": check_relay_probe,
        "relay-logrotate": check_relay_logrotate,
        "node-agent": check_node_agent,
    }
    for component in dict.fromkeys(args.components):
        checks[component](node, report, not args.no_smoke)
    print(f"{'FAILED' if report.failed else 'OK'}: {report.failed} failed check(s)")
    return 1 if report.failed else 0


if __name__ == "__main__":
    sys.exit(main())
