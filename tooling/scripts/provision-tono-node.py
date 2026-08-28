#!/usr/bin/env python3
"""Transactional, single-node Tono provisioner (Python stdlib only).

Secrets are deliberately confined to the inventory, SSH stdin, and private state.
Machine-readable stdout contains only an anonymous inventory-derived identifier.
"""
from __future__ import annotations

import argparse, base64, hashlib, json, os, re, secrets, shutil, stat, subprocess, sys, tempfile, urllib.request, zipfile
from pathlib import Path
from typing import Any, Callable

XRAY_VERSION = "v26.3.27"
XRAY_ASSETS = {
    "x86_64": ("Xray-linux-64.zip", "23cd9af937744d97776ee35ecad4972cf4b2109d1e0fe6be9930467608f7c8ae"),
    "aarch64": ("Xray-linux-arm64-v8a.zip", "4d30283ae614e3057f730f67cd088a42be6fdf91f8639d82cb69e48cde80413c"),
}
REPO = Path(__file__).resolve().parents[1]
HELPER = Path(__file__).with_name("remote") / "manage-tono-node-v2.sh"
# The one place the Reality front measurement lives, shared with
# provision-reality-node.rb and check-node-in-fleet.py.
REALITY_FRONTS = json.loads(Path(__file__).with_name("reality-fronts.json").read_text("utf-8"))

class ProvisionError(RuntimeError): pass
class IndeterminateRestart(ProvisionError): pass

def canonical(obj: Any) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()

def anonymous_id(node_id: str) -> str:
    return hashlib.sha256(("tono-node:" + node_id).encode()).hexdigest()[:12]

def private_path(raw: str, *, may_create: bool, acl_probe: Callable[[Path], bool] | None = None) -> Path:
    p = Path(raw)
    if not p.is_absolute(): raise ProvisionError("security path must be absolute")
    p = p.resolve(strict=False)
    try: p.relative_to(REPO)
    except ValueError: pass
    else: raise ProvisionError("security path must be outside the repository")
    existing = p if p.exists() else p.parent
    if not existing.exists() and not may_create: raise ProvisionError("security path does not exist")
    if p.exists() and (p.is_symlink() or (os.name == "nt" and os.path.islink(p))): raise ProvisionError("security path must not be a link/reparse point")
    if os.name == "nt":
        probe = acl_probe or windows_private_acl
        if existing.exists() and not probe(existing): raise ProvisionError("Windows ACL is not current-user-only")
    elif existing.exists():
        s = existing.stat()
        if s.st_uid != os.getuid() or s.st_mode & 0o077: raise ProvisionError("path must be owner-only")
    return p

def windows_private_acl(path: Path) -> bool:
    # Fail closed. PowerShell evaluates every explicit/inherited allow principal;
    # SYSTEM and Administrators are accepted for OS recoverability.
    script = r'''$p=$args[0];$i=Get-Item -LiteralPath $p -Force;if(($i.Attributes -band [IO.FileAttributes]::ReparsePoint)-ne 0){exit 1};$me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$a=@((Get-Acl -LiteralPath $p).Access|?{$_.AccessControlType -eq 'Allow'});if($a.Count-eq 0){exit 1};$ok=$true;$a|%{$s=$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value;if($s -notin @($me,'S-1-5-18','S-1-5-32-544')){$ok=$false}};if($ok){exit 0}else{exit 1}'''
    try: return subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script, str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    except OSError: return False

def system_openssh(name: str) -> str:
    if os.name == "nt":
        p=Path(os.environ.get("SystemRoot",r"C:\Windows"))/"System32"/"OpenSSH"/(name+".exe")
        if not p.is_file(): raise ProvisionError("system OpenSSH unavailable")
        return str(p)
    p=shutil.which(name)
    if not p: raise ProvisionError("system OpenSSH unavailable")
    return p

def ssh_options(inv: dict, known_hosts: Path) -> list[str]:
    return ["-F", "NUL" if os.name == "nt" else "/dev/null", "-i", inv["identityFile"],
      "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
      "-o", f"UserKnownHostsFile={known_hosts}", "-o", f"GlobalKnownHostsFile={'NUL' if os.name == 'nt' else '/dev/null'}",
      "-o", "KnownHostsCommand=none", "-o", "IdentityAgent=none", "-o", "IdentitiesOnly=yes",
      "-o", "ForwardAgent=no", "-o", "ClearAllForwardings=yes", "-o", "ControlMaster=no",
      "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=10", "-o", "ServerAliveCountMax=2"]

def strict_ssh_args(inv: dict, known_hosts: Path) -> list[str]:
    return [system_openssh("ssh"), "-T", "-p", str(inv["port"]), *ssh_options(inv,known_hosts), "--", f'{inv["user"]}@{inv["host"]}']

def framed_helper(request: dict, source: bytes) -> bytes:
    # Assignment is shell-safe because base64 has no shell metacharacters. The
    # request is not appended after source, so bash and request decoding never
    # compete for stdin.
    encoded = base64.b64encode(canonical(request)).decode("ascii")
    return ("TONO_REQUEST_B64='" + encoded + "'\nexport TONO_REQUEST_B64\n").encode() + source

class Runner:
    def __init__(self, inv: dict, known_hosts: Path): self.inv, self.known_hosts, self.args = inv, known_hosts, strict_ssh_args(inv, known_hosts)
    def call(self, req: dict, *, restart=False) -> dict:
        cmd = self.args + ["if [ \"$(id -u)\" = 0 ]; then exec bash -s; else exec sudo -n bash -s; fi"]
        p = subprocess.run(cmd, input=framed_helper(req, HELPER.read_bytes()), stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=90)
        if restart and p.returncode == 255: raise IndeterminateRestart("restart transport became indeterminate")
        if p.returncode: raise ProvisionError("remote operation failed")
        try: result = json.loads(p.stdout)
        except Exception as e: raise ProvisionError("invalid remote response") from e
        if not isinstance(result, dict) or not result.get("ok"): raise ProvisionError("remote operation rejected")
        return result
    def upload(self, local: Path, remote: str) -> None:
        # Do not derive SCP options by slicing SSH argv: both use the same builder.
        args = [system_openssh("scp"), "-q", "-P", str(self.inv["port"]), *ssh_options(self.inv,self.known_hosts), "--", str(local), f'{self.inv["user"]}@{self.inv["host"]}:{remote}']
        if subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=90).returncode: raise ProvisionError("artifact staging failed")

def read_inventory(path: Path, node_id: str) -> dict:
    data = json.loads(path.read_text("utf-8")); nodes = data.get("nodes", {})
    if node_id not in nodes or not isinstance(nodes[node_id], dict): raise ProvisionError("unknown node")
    n = dict(nodes[node_id]); required = {"host","user","port","identityFile","mode","servicePort","realityTarget","configPath","serviceName","catalogName","publicServer"}
    if set(n) - (required | {"komariManifest","binaryPath"}) or not required <= set(n): raise ProvisionError("invalid inventory schema")
    if n["mode"] not in ("fresh", "extend") or not 1 <= int(n["port"]) <= 65535 or not 1 <= int(n["servicePort"]) <= 65535: raise ProvisionError("invalid inventory value")
    for k in ("configPath",):
        if not str(n[k]).startswith("/"): raise ProvisionError("remote paths must be absolute")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+\.service", n["serviceName"]): raise ProvisionError("invalid service name")
    if not re.fullmatch(r"/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+\.json", n["configPath"]): raise ProvisionError("configPath must be a simple absolute JSON path")
    # The front reaches the customer or nothing does, and nothing else in this
    # flow stands where the customer stands: the remote precheck runs on the VPS
    # and the verification runs here, so an unreachable front passes both.
    host = str(n["realityTarget"]).strip().lower()
    if any(host == d or host.endswith(f".{d}") for d in REALITY_FRONTS["unusable"]): raise ProvisionError(f"realityTarget {host} was measured unusable from inside the main market; see tooling/scripts/reality-fronts.json")
    return n

def desired(inv: dict, flags: argparse.Namespace) -> dict:
    return {k: inv[k] for k in ("mode","servicePort","realityTarget","configPath","serviceName")} | {"version": XRAY_VERSION, "enableBbr": flags.enable_bbr, "allowFirewallChange": flags.allow_firewall_change}

def write_private(path: Path, obj: Any) -> None:
    if not path.parent.is_dir(): raise ProvisionError("state-dir must pre-exist")
    tmp = path.with_name(path.name + ".new-" + secrets.token_hex(6))
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb") as f: f.write(canonical(obj)); f.flush(); os.fsync(f.fileno())
        os.replace(tmp, path); os.chmod(path, 0o600)
        if os.name == "nt" and (not windows_private_acl(path.parent) or not windows_private_acl(path)): raise ProvisionError("private ACL re-probe failed")
    finally:
        if tmp.exists(): tmp.unlink()

def download_xray(arch: str, directory: Path, opener=urllib.request.urlopen) -> tuple[Path,str]:
    if arch not in XRAY_ASSETS: raise ProvisionError("unsupported architecture")
    name, expected = XRAY_ASSETS[arch]; archive = directory / name
    with opener(f"https://github.com/XTLS/Xray-core/releases/download/{XRAY_VERSION}/{name}") as src, open(archive,"wb") as out: shutil.copyfileobj(src,out)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != expected: raise ProvisionError("pinned Xray checksum mismatch")
    with zipfile.ZipFile(archive) as z:
        if "xray" not in z.namelist(): raise ProvisionError("Xray archive missing binary")
        target=directory/"xray"; target.write_bytes(z.read("xray")); os.chmod(target,0o700)
    return target, hashlib.sha256(target.read_bytes()).hexdigest()

def validate_komari(inv: dict, enabled: bool) -> None:
    if not enabled: return
    p=inv.get("komariManifest");
    if not p: raise ProvisionError("private Komari manifest required")
    m=json.loads(Path(p).read_text("utf-8"))
    if m.get("version") != "1.2.60" or not re.fullmatch(r"[0-9a-f]{64}",m.get("sha256","")): raise ProvisionError("invalid Komari manifest")

def state_file(state_dir: Path, anon: str) -> Path: return state_dir / (anon + ".json")

def execute(args: argparse.Namespace, runner_factory=Runner) -> dict:
    inventory=private_path(args.inventory,may_create=False); known=private_path(args.known_hosts,may_create=False)
    state_dir=private_path(args.state_dir,may_create=False); inv=read_inventory(inventory,args.node_id)
    if not inventory.is_file() or not known.is_file() or not state_dir.is_dir(): raise ProvisionError("inventory/known-hosts files and pre-existing state directory are required")
    identity=private_path(inv["identityFile"],may_create=False)
    if not identity.is_file(): raise ProvisionError("identity file is required")
    validate_komari(inv,args.enable_komari_agent)
    anon=anonymous_id(args.node_id); sf=state_file(state_dir,anon); state=json.loads(sf.read_text()) if sf.exists() else None
    runner=runner_factory(inv,known); want=desired(inv,args)
    base={"anonymousId":anon,"stage":args.stage}
    if args.stage == "plan":
        r=runner.call({"op":"preflight","desired":want}); return base|{"changed":False,"actions":r.get("actions",[]),"firewallChangeRequired":r.get("firewallChangeRequired",False)}
    if args.stage == "verify":
        if not state: raise ProvisionError("no local transaction state")
        r=runner.call({"op":"verify","transactionId":state["transactionId"],"expected":state["expected"],"desired":state["desired"]}); return base|{"healthy":bool(r.get("healthy"))}
    if args.stage == "rollback":
        if not state: raise ProvisionError("no local transaction state")
        runner.call({"op":"rollback","transactionId":state["transactionId"],"desired":state["desired"]}); runner.call({"op":"verify-restored","transactionId":state["transactionId"],"desired":state["desired"]}); sf.unlink(); return base|{"changed":True,"restored":True}
    if args.stage == "enroll-draft":
        if not state or not state.get("verified"): raise ProvisionError("verified state required")
        if args.expected_revision is None: raise ProvisionError("expectedRevision required")
        c=state["client"]
        fragment={"name":inv["catalogName"],"type":"vless","server":inv["publicServer"],"port":inv["servicePort"],"uuid":c["uuid"],"network":"tcp","tls":True,"udp":True,"servername":inv["realityTarget"],"client-fingerprint":"chrome","reality-opts":{"public-key":c["publicKey"],"short-id":c["shortId"]},"flow":"xtls-rprx-vision"}
        if not all(fragment.get(k) for k in ("name","server","uuid","servername")) or not all(fragment["reality-opts"].values()): raise ProvisionError("incomplete enrollment fragment")
        draft={"expectedRevision":args.expected_revision,"requiresHumanCASConfirmation":True,"published":False,"node":fragment,"redactedCatalogDiff":{"anonymousId":anon,"operation":"add"}}
        write_private(state_dir/(anon+"-enrollment-draft.json"),draft); return base|{"changed":True,"published":False}
    if state:
        if state.get("desired") != want: raise ProvisionError("desired state differs; rollback or rotation required")
        r=runner.call({"op":"verify","transactionId":state["transactionId"],"expected":state["expected"],"desired":state["desired"]})
        if r.get("healthy"): return base|{"changed":False,"verified":True}
        raise ProvisionError("existing transaction is not healthy; rollback required")
    pre=runner.call({"op":"preflight","desired":want})
    if pre.get("firewallChangeRequired") and not args.allow_firewall_change: raise ProvisionError("firewall approval required")
    if args.enable_komari_agent: raise ProvisionError("Komari installation is not yet supported")
    tx=secrets.token_hex(16); remote_artifact=None; apply_invoked=False
    # Durable recovery intent exists before upload or any remote mutation.
    write_private(sf,{"transactionId":tx,"desired":want,"expected":pre.get("expected",{}),"verified":False,"recoveryRequired":True,"phase":"pending"})
    try:
        apply_invoked=True
        runner.call({"op":"prepare","transactionId":tx,"desired":want})
        if inv["mode"] == "fresh":
            with tempfile.TemporaryDirectory() as td:
                binary,digest=download_xray(pre["arch"],Path(td)); remote_artifact=f"/tmp/tono-xray-{tx}"; runner.upload(binary,remote_artifact)
                applied=runner.call({"op":"apply","transactionId":tx,"desired":want,"artifact":remote_artifact,"artifactSha256":digest},restart=True)
        else: applied=runner.call({"op":"apply","transactionId":tx,"desired":want},restart=True)
    except IndeterminateRestart:
        applied={"transactionId":tx,"expected":pre.get("expected",{})}
    except Exception:
        try:
            if apply_invoked: runner.call({"op":"rollback","transactionId":tx,"desired":want}); runner.call({"op":"verify-restored","transactionId":tx,"desired":want})
            sf.unlink()
        except Exception:
            # Keep recoveryRequired pending state unless restored verification completed.
            pass
        raise
    expected=applied.get("expected",pre.get("expected",{}))
    try:
        verified=runner_factory(inv,known).call({"op":"verify","transactionId":tx,"expected":expected,"desired":want})
        if not verified.get("healthy"): raise ProvisionError("post-restart verification failed")
    except Exception:
        try:
            fresh=runner_factory(inv,known); fresh.call({"op":"rollback","transactionId":tx,"desired":want}); fresh=runner_factory(inv,known); fresh.call({"op":"verify-restored","transactionId":tx,"desired":want}); sf.unlink()
        except Exception: pass
        raise
    record={"transactionId":tx,"desired":want,"expected":expected,"verified":True,"client":applied.get("client",verified.get("client",{}))}
    write_private(sf,record); return base|{"changed":True,"verified":True}

def parser() -> argparse.ArgumentParser:
    p=argparse.ArgumentParser(); p.add_argument("stage",choices=("plan","apply","verify","rollback","enroll-draft"),nargs="?",default="plan")
    p.add_argument("--inventory",required=True); p.add_argument("--node-id",required=True); p.add_argument("--known-hosts",required=True); p.add_argument("--state-dir",required=True)
    p.add_argument("--enable-bbr",action="store_true"); p.add_argument("--allow-firewall-change",action="store_true"); p.add_argument("--enable-komari-agent",action="store_true"); p.add_argument("--expected-revision",type=lambda v: int(v) if int(v)>=0 else (_ for _ in ()).throw(argparse.ArgumentTypeError("must be >= 0")))
    return p

def main() -> int:
    try: print(json.dumps(execute(parser().parse_args()),sort_keys=True)); return 0
    except ProvisionError as e: print(str(e),file=sys.stderr); return 1
    except Exception: print("local provisioning operation failed",file=sys.stderr); return 1
if __name__ == "__main__": raise SystemExit(main())
