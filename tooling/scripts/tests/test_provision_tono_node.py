import base64, hashlib, importlib.util, io, json, os, shutil, subprocess, tempfile, unittest, zipfile
from pathlib import Path
from unittest import mock

ROOT=Path(__file__).resolve().parents[2]
SPEC=importlib.util.spec_from_file_location("provision",ROOT/"scripts/provision-tono-node.py")
P=importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(P)
SH=(ROOT/"scripts/remote/manage-tono-node-v2.sh").read_text()

class Contracts(unittest.TestCase):
 def test_redaction_deterministic(self):
  self.assertEqual(P.anonymous_id("opaque"),P.anonymous_id("opaque")); self.assertNotIn("opaque",P.anonymous_id("opaque"))
 def test_strict_ssh_boundary(self):
  a=P.strict_ssh_args({"port":22,"identityFile":"X","user":"u","host":"h"},Path("K")); s=" ".join(a)
  for x in ("StrictHostKeyChecking=yes","UserKnownHostsFile=K","GlobalKnownHostsFile=","KnownHostsCommand=none","IdentityAgent=none","IdentitiesOnly=yes","BatchMode=yes","ClearAllForwardings=yes","ControlMaster=no","-i X"): self.assertIn(x,s)
 def test_acl_probe_fail_closed_and_repo_rejected(self):
  with self.assertRaises(P.ProvisionError): P.private_path(str(ROOT/"secret"),may_create=True,acl_probe=lambda p:True)
  # Never fake os.name: pathlib and tempfile cache process-global platform state.
  with tempfile.TemporaryDirectory() as d:
   if os.name == "nt":
    with self.assertRaises(P.ProvisionError): P.private_path(d,may_create=False,acl_probe=lambda p:False)
   else:
    os.chmod(d,0o755)
    try:
     with self.assertRaises(P.ProvisionError): P.private_path(d,may_create=False)
    finally: os.chmod(d,0o700)
 def test_inventory_rejects_non_json_config_and_non_service_unit(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/"i"; p.write_text(json.dumps({"nodes":{"n":{"host":"h","user":"u","port":22,"identityFile":"x","mode":"fresh","servicePort":443,"realityTarget":"t.invalid","configPath":"/etc/xray/config","serviceName":"xray","catalogName":"n","publicServer":"p.invalid"}}}))
   with self.assertRaises(P.ProvisionError): P.read_inventory(p,"n")
 def test_inventory_rejects_a_front_measured_unusable_in_the_main_market(self):
  # Nothing downstream can catch this one: the remote precheck runs on the VPS
  # and the verification runs on this machine, so a front no customer can reach
  # is consistent everywhere and the node reads as healthy while serving nobody.
  node={"host":"h","user":"u","port":22,"identityFile":"x","mode":"fresh","servicePort":443,"realityTarget":"WWW.Cloudflare.com","configPath":"/etc/xray/config.json","serviceName":"xray.service","catalogName":"n","publicServer":"p.invalid"}
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/"i"; p.write_text(json.dumps({"nodes":{"n":node}}))
   with self.assertRaises(P.ProvisionError): P.read_inventory(p,"n")
   node["realityTarget"]=P.REALITY_FRONTS["default"]
   p.write_text(json.dumps({"nodes":{"n":node}}))
   self.assertEqual(P.REALITY_FRONTS["default"],P.read_inventory(p,"n")["realityTarget"])
 def test_framing_decoder(self):
  req={"op":"x","value":"quote' newline\n"}; framed=P.framed_helper(req,b"echo source\n")
  line=framed.splitlines()[0].decode(); enc=line.split("'",2)[1]
  self.assertEqual(req,json.loads(base64.b64decode(enc)))
  self.assertTrue(framed.endswith(b"echo source\n")); self.assertNotIn(P.canonical(req),framed[len(line)+1:])
 def test_local_bash_actual_helper_decoder(self):
  bash=shutil.which("bash")
  if not bash: self.skipTest("bash unavailable")
  # Execute the helper's real decoder/functions, replacing only privilege and dispatch.
  src=SH.replace('[[ $(id -u) == 0 ]] || fail "root or passwordless sudo required"',':').rsplit('case "$op"',1)[0]+'printf \'%s\\n\' "$REQUEST"\n'
  req={"op":"decoder-proof","desired":{"mode":"fresh"}}
  r=subprocess.run([bash],input=P.framed_helper(req,src.encode()),stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  self.assertEqual(0,r.returncode,r.stderr.decode()); self.assertEqual(req,json.loads(r.stdout))
 def test_pins_and_checksum_rejection(self):
  self.assertEqual("v26.3.27",P.XRAY_VERSION)
  class C(io.BytesIO):
   def __enter__(self): return self
   def __exit__(self,*a): pass
  with tempfile.TemporaryDirectory() as d:
   with self.assertRaises(P.ProvisionError): P.download_xray("x86_64",Path(d),lambda u:C(b"bad"))
 def test_remote_transaction_contracts(self):
  for text in ("manifest.sha256","! -name manifest.sha256","chmod -R a-w","tono-$id.tmp","chown --reference","run -test","mv -f","CentOS/RHEL 7 is unsupported","modinfo tcp_bbr","primary root qdisc must already be fq","net.ipv4.tcp_congestion_control = bbr\\nnet.core.default_qdisc = fq","SSH allow rule not proven","tono-tx-$id","systemctl is-active","journalctl","ss -H -lntp","config parent must be root-owned","network error counters increased","drop/retrans counters increased abnormally","user-created","group-created","transaction user still owns a process","service command is not bound to managed config","/proc/'+pid+'/cmdline","/proc/'+pid+'/environ","len(hits)!=1","install -d -o root -g root -m 0755","partial transaction became current","transaction temporary artifact remains","restored-pending-verification","no-managed-mutation","service-enabled-by-transaction","bbr-module-loaded-by-transaction","extend service must already be active"):
   self.assertIn(text,SH)
  for text in ("# shellcheck source=/etc/os-release",'local d="$TX/backup/$name"','if ! [[ $port =~ ^[0-9]+$ ]]','if getent group tono-xray','if ! { [[ -z $stopped_pid','/sys/class/net/"$iface"/statistics/rx_dropped'):
   self.assertIn(text,SH)
  for text in ('local name=$1 path=$2 d=', '/sys/class/net/$iface/', '&& ((port>0&&port<65536)) || fail', '! getent group tono-xray >/dev/null &&'):
   self.assertNotIn(text,SH)
  self.assertNotIn("iptables",SH); self.assertNotIn("nft ",SH); self.assertNotIn("firewall-cmd",SH)
  self.assertNotIn('exec 9>"/run/lock/tono-node.lock"\nvalid_common',SH)
 def test_extend_structural_logic_preserves_semantics(self):
  self.assertIn("after=json.loads(json.dumps(before))",SH); self.assertIn("hits[0][1].append",SH); self.assertIn("old clients not preserved",SH)
 def test_bbr_noop_condition_and_premutation_guard(self):
  self.assertLess(SH.index("bbr_probe; fi # all unsafe checks before backup/mutation"),SH.index("backup; printf"))
  self.assertIn("tcp_congestion_control) != bbr",SH)
 def test_verify_cannot_claim_absent_healthy(self): self.assertIn("managed artifacts absent",SH)
 def test_komari_validation(self):
  with self.assertRaises(P.ProvisionError): P.validate_komari({},True)
  self.assertNotIn("komari",SH.lower())

class FakeRunner:
 instances=[]; script=[]
 def __init__(self,*a): self.calls=[]; self.uploads=[]; FakeRunner.instances.append(self)
 def call(self,r,**kw):
  self.calls.append((r,kw)); x=FakeRunner.script.pop(0)
  if isinstance(x,Exception): raise x
  return x
 def upload(self,*x): self.uploads.append(x)

class Flow(unittest.TestCase):
 def setUp(self):
  self.t=tempfile.TemporaryDirectory(); root=Path(self.t.name); self.inv=root/"inventory.json"; self.kh=root/"known"; self.key=root/"key"; self.state=root/"state"
  self.kh.write_text("k"); self.key.write_text("k"); os.chmod(root,0o700); os.chmod(self.kh,0o600); os.chmod(self.key,0o600)
  self.node={"host":"placeholder.invalid","user":"root","port":22,"identityFile":str(self.key),"mode":"extend","servicePort":443,"realityTarget":"target.invalid","configPath":"/etc/xray/config.json","serviceName":"xray.service","catalogName":"node","publicServer":"public.invalid"}
  self.inv.write_text(json.dumps({"nodes":{"opaque":self.node}})); os.chmod(self.inv,0o600); FakeRunner.instances=[]
  self.state.mkdir(); os.chmod(self.state,0o700)
  self.acl=mock.patch.object(P,"windows_private_acl",return_value=True); self.acl.start()
 def tearDown(self): self.acl.stop(); self.t.cleanup()
 def args(self,stage="apply",**kw):
  d=dict(stage=stage,inventory=str(self.inv),node_id="opaque",known_hosts=str(self.kh),state_dir=str(self.state),enable_bbr=False,allow_firewall_change=False,enable_komari_agent=False,expected_revision=None); d.update(kw); return type("A",(),d)()
 def test_repeated_apply_no_remote_writes(self):
  sf=P.state_file(self.state,P.anonymous_id("opaque")); want=P.desired(self.node,self.args()); P.write_private(sf,{"transactionId":"a"*32,"desired":want,"expected":{},"verified":True,"client":{}})
  FakeRunner.script=[{"ok":True,"healthy":True}]; out=P.execute(self.args(),FakeRunner)
  self.assertFalse(out["changed"]); self.assertEqual("verify",FakeRunner.instances[0].calls[0][0]["op"])
 def test_indeterminate_then_fresh_verify(self):
  FakeRunner.script=[{"ok":True,"arch":"x86_64"},{"ok":True,"prepared":True},P.IndeterminateRestart(),{"ok":True,"healthy":True,"client":{}}]
  out=P.execute(self.args(),FakeRunner); self.assertTrue(out["verified"]); self.assertGreaterEqual(len(FakeRunner.instances),2)
 def test_mismatch_rolls_back_and_fresh_verifies(self):
  FakeRunner.script=[{"ok":True,"arch":"x86_64"},{"ok":True,"prepared":True},{"ok":True,"expected":{}},{"ok":True,"healthy":False},{"ok":True},{"ok":True}]
  with self.assertRaises(P.ProvisionError): P.execute(self.args(),FakeRunner)
  ops=[c[0]["op"] for i in FakeRunner.instances for c in i.calls]; self.assertIn("rollback",ops); self.assertIn("verify-restored",ops)
 def test_injected_apply_failure_rolls_back(self):
  FakeRunner.script=[{"ok":True,"arch":"x86_64"},{"ok":True,"prepared":True},RuntimeError("injected"),{"ok":True},{"ok":True}]
  with self.assertRaises(RuntimeError): P.execute(self.args(),FakeRunner)
  self.assertEqual(["preflight","prepare","apply","rollback","verify-restored"],[x[0]["op"] for x in FakeRunner.instances[0].calls])
  self.assertIn("desired",FakeRunner.instances[0].calls[-1][0])
 def test_ufw_approval_gate(self):
  FakeRunner.script=[{"ok":True,"arch":"x86_64","firewallChangeRequired":True}]
  with self.assertRaises(P.ProvisionError): P.execute(self.args(),FakeRunner)
 def test_fresh_stages_artifact(self):
  self.node["mode"]="fresh"; self.inv.write_text(json.dumps({"nodes":{"opaque":self.node}}))
  FakeRunner.script=[{"ok":True,"arch":"x86_64"},{"ok":True,"prepared":True},{"ok":True},{"ok":True}]
  with mock.patch.object(P,"download_xray",side_effect=RuntimeError("download reached")):
   with self.assertRaises(RuntimeError): P.execute(self.args(),FakeRunner)
 def test_enroll_requires_verified_and_cas_never_publish(self):
  with self.assertRaises(P.ProvisionError): P.execute(self.args("enroll-draft"),FakeRunner)
  sf=P.state_file(self.state,P.anonymous_id("opaque")); P.write_private(sf,{"transactionId":"a"*32,"desired":{},"expected":{},"verified":True,"client":{"uuid":"a","publicKey":"b","shortId":"c"}})
  out=P.execute(self.args("enroll-draft",expected_revision=0),FakeRunner); self.assertFalse(out["published"])
  draft=json.loads((self.state/(P.anonymous_id("opaque")+"-enrollment-draft.json")).read_text()); self.assertTrue(draft["requiresHumanCASConfirmation"]); self.assertFalse(draft["published"])

if __name__=="__main__": unittest.main()
