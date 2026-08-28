# frozen_string_literal: true

# Run with: ruby tooling/scripts/tests/provision-reality-node.test.rb
#
# The provisioner is executed for real. Every case here is decided while its
# arguments are still being validated, so nothing leaves the machine and no VPS
# is required: the refusal is raised before the first SSH call, and the override
# is only asserted not to raise it.

require "json"
require "minitest/autorun"
require "open3"
require "rbconfig"

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
