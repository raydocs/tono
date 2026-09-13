# frozen_string_literal: true

# Run with: ruby tooling/scripts/tests/provision-reality-node.test.rb
#
# The provisioner is executed for real. Every case here is decided while its
# arguments are still being validated, so nothing leaves the machine and no VPS
# is required: the refusal is raised before the first SSH call, and the override
# is only asserted not to raise it.

require "fileutils"
require "json"
require "minitest/autorun"
require "open3"
require "rbconfig"
require "tmpdir"

SCRIPT = File.expand_path("../provision-reality-node.rb", __dir__)
FRONTS = JSON.parse(File.read(File.expand_path("../reality-fronts.json", __dir__))).freeze
REFUSAL = /measured as unusable/

def provision(*arguments)
  # --server is supplied so the run never resolves the SSH target, and no
  # --apply, so nothing is installed even if a case reaches that far.
  Open3.capture3(
    RbConfig.ruby, SCRIPT,
    "--ssh", "tono-provisioner-test", "--name", "Test · Node", "--server", "203.0.113.10",
    *arguments,
  )
end

class MeasuredRealityFront < Minitest::Test
  def test_the_default_front_is_the_one_measured_usable
    assert_includes(FRONTS.fetch("usable"), FRONTS.fetch("default"))
    # The default is taken from the shared measurement, not repeated here: a
    # second copy is what lets a re-measurement update one place and not the
    # other.
    assert_includes(File.read(SCRIPT), 'DEFAULT_REALITY_TARGET = REALITY_FRONTS.fetch("default")')
  end

  def test_a_front_measured_unusable_is_refused
    # Neither of the checks in this flow stands where the customer does — the
    # TLS 1.3 precheck runs on the VPS and the data-plane test runs here — so a
    # front nobody in the main market can reach passes both.
    FRONTS.fetch("unusable").each do |domain|
      ["www.#{domain}", domain].each do |host|
        _, stderr, status = provision("--servername", host)
        refute_predicate(status, :success?, host)
        assert_match(REFUSAL, stderr, host)
        assert_match(/#{Regexp.escape(FRONTS.fetch("default"))}/, stderr, host)
      end
    end
  end

  def test_the_measured_default_is_not_refused
    _, stderr, _ = provision("--servername", FRONTS.fetch("default"))
    refute_match(REFUSAL, stderr)
  end

  def test_an_unmeasured_front_is_not_refused
    _, stderr, _ = provision("--servername", "www.example.com")
    refute_match(REFUSAL, stderr)
  end

  def test_the_refusal_is_overridable
    _, stderr, _ = provision("--servername", "www.cloudflare.com", "--allow-unusable-servername")
    refute_match(REFUSAL, stderr)
  end
end

class Hy2StaysOptIn < Minitest::Test
  REALITY_REMOTE = File.expand_path("../remote/manage-tono-reality-node.sh", __dir__)
  HY2_REMOTE = File.expand_path("../remote/manage-tono-hy2-node.sh", __dir__)

  def test_dry_run_without_hy2_does_not_open_udp
    source = File.read(SCRIPT)
    remote = File.read(REALITY_REMOTE)
    refute_match(/\bhysteria\b/i, remote)
    refute_match(/ss -H -lun/, remote)
    assert_match(/ss -H -ltn/, remote)
    assert_match(/hy2: false,/, source)
    assert_match(/UDP remains closed/, source)
    refute_match(/manage-tono-hy2-node/, remote)
  end

  def test_hy2_remote_does_not_stop_or_rewrite_xray
    hy2 = File.read(HY2_REMOTE)
    refute_match(/systemctl (disable|stop) .*tono-xray/, hy2)
    refute_match(%r{rm .*/opt/tono-xray}, hy2)
    assert_match(/ss -H -lun/, hy2)
    assert_match(/CERT_CN="www\.microsoft\.com"/, hy2)
    assert_match(/subjectAltName=DNS:\$CERT_CN/, hy2)
    assert_match(/This script must never stop, replace, or rewrite tono-xray/, hy2)
  end

  def test_hy2_auth_is_http_over_every_xray_uuid_not_the_first_password
    hy2 = File.read(HY2_REMOTE)
    source = File.read(SCRIPT)
    refute_match(/clients\[0\]\["id"\]/, hy2)
    refute_match(/password: \$password/, hy2)
    assert_match(/type: http/, hy2)
    assert_match(/sync-identities/, hy2)
    refute_match(/type: command/, hy2)
    assert_match(/127\.0\.0\.1:18765/, hy2)
    assert_match(/hy2_sync_identities/, source)
    assert_match(/--hy2-sync-identities/, source)
    assert_match(/wait_localhost_tcp 18765/, hy2)
    assert_match(/pre-http-auth/, hy2)
    assert_match(/knownUuidAccepted/, hy2)
    assert_match(/this path never rewrites tono-hy2\.service/, hy2)
    refute_match(/private_output_path!.*hy2_sync/, source)
    assert_match(/Identity sync never writes a catalog source/, source)
  end
end

class CatalogPlaceholderAfterIsolatedTest < Minitest::Test
  PUBLISHER = File.expand_path("../publish-managed-catalog.rb", SCRIPT)

  def setup
    load SCRIPT unless defined?(rewrite_vless_uuid_to_placeholder!)
    @directory = Dir.mktmpdir("provision-placeholder")
    File.chmod(0o700, @directory)
  end

  def teardown
    FileUtils.remove_entry(@directory)
  end

  def test_rewritten_private_source_is_a_valid_catalog_append_source
    path = File.join(@directory, "westwood.yaml")
    write_private_yaml(path, {
      "proxies" => [{
        "name" => "Los Angeles · Westwood",
        "type" => "vless",
        "server" => "203.0.113.12",
        "port" => 443,
        "uuid" => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        "network" => "tcp",
        "tls" => true,
        "udp" => true,
        "servername" => "www.ucla.edu",
        "client-fingerprint" => "chrome",
        "flow" => "xtls-rprx-vision",
        "reality-opts" => {
          "public-key" => "C" * 43,
          "short-id" => "0123456701234567",
        },
      }],
    })
    refute_includes(File.binread(path), CLIENT_UUID_PLACEHOLDER)
    rewrite_vless_uuid_to_placeholder!(path)
    rewritten = File.binread(path).force_encoding(Encoding::UTF_8)
    assert_includes(rewritten, "uuid: #{CLIENT_UUID_PLACEHOLDER}")
    refute_match(/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/, rewritten)
    stdout, stderr, status = Open3.capture3(RbConfig.ruby, PUBLISHER, "--dry-run", path)
    assert_predicate(status, :success?, stdout + stderr)
    assert_match(/1 per-account identity placeholders/, stdout)
  end
end
