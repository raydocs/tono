# frozen_string_literal: true

# Run with: ruby tooling/scripts/tests/publish-managed-catalog.test.rb
#
# The publisher is executed for real. Only the two edges that leave the machine
# are replaced — the Keychain read and the control-plane request — by splicing
# stubs into the source between the helper definitions and the main flow, so
# every catalog code path under test is the shipped one. No network is used.

require "fileutils"
require "json"
require "minitest/autorun"
require "tmpdir"
require "yaml"

SCRIPT = File.expand_path("../publish-managed-catalog.rb", __dir__)
MARKER = "\nmode = :dry_run\n"
PLACEHOLDER = "{{TONO_CLIENT_UUID}}"

STUBS = <<~RUBY
  module Open3
    def self.capture2(*)
      [ENV.fetch("STUB_TOKEN"), Class.new { def success?; true; end }.new]
    end
  end

  def request(_uri, _token, method, body = nil)
    metadata = JSON.parse(File.binread(ENV.fetch("STUB_GET")).force_encoding(Encoding::UTF_8))
    return metadata if method == Net::HTTP::Get
    File.binwrite(ENV.fetch("STUB_PUT"), body)
    { "revision" => metadata.fetch("revision") + 1, "sha256" => "0" * 64 }
  end
RUBY

# Re-emits the catalog from a parsed document instead of splicing text, so the
# invariant asserted before the upload has something to refuse.
ROUND_TRIP = <<~RUBY
  def catalog_text(prefix, blocks, suffix)
    document = YAML.safe_load("\#{prefix}\#{blocks.join("\\n")}\\n\#{suffix}")
    YAML.dump(document).sub(/\\A---\\s*\\n/, "")
  end
RUBY

CURRENT_CATALOG = <<~YAML
  # Managed exit catalog. The identity placeholder must survive every publish.
  proxies:
    - name: "Los Angeles · Pacific"
      type: vless
      server: 203.0.113.10
      port: 443
      uuid: #{PLACEHOLDER}
      network: tcp
      tls: true
      udp: true
      servername: www.bing.com
      client-fingerprint: chrome
      flow: xtls-rprx-vision
      reality-opts:
        public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
        short-id: 0123456789abcdef
    - name: Tokyo Reality
      type: vless
      server: 203.0.113.11
      port: 443
      uuid: #{PLACEHOLDER}
      network: tcp
      tls: true
      udp: true
      servername: www.bing.com
      client-fingerprint: chrome
      flow: xtls-rprx-vision
      reality-opts:
        public-key: BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB
        short-id: fedcba9876543210
YAML

# Written the way the provisioner writes a private source: YAML.dump puts list
# items at column zero, so the publisher has to re-indent before splicing.
NEW_SOURCE = <<~YAML
  proxies:
  - name: Singapore Reality
    type: vless
    server: 203.0.113.12
    port: 443
    uuid: #{PLACEHOLDER}
    network: tcp
    tls: true
    udp: true
    servername: www.bing.com
    client-fingerprint: chrome
    flow: xtls-rprx-vision
    reality-opts:
      public-key: CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC
      short-id: 0123456701234567
YAML

class PublishManagedCatalogTest < Minitest::Test
  def setup
    @directory = Dir.mktmpdir("publish-managed-catalog")
  end

  def teardown
    FileUtils.remove_entry(@directory)
  end

  def source(name, content)
    path = File.join(@directory, name)
    File.binwrite(path, content)
    File.chmod(0o600, path)
    path
  end

  def run_publisher(arguments, current: nil, revision: 7, corrupt: false)
    original = File.binread(SCRIPT).force_encoding(Encoding::UTF_8)
    head, tail = original.split(MARKER, 2)
    refute_nil(tail, "the publisher no longer has the expected main-flow marker")
    harness = File.join(@directory, "harness.rb")
    File.binwrite(harness, head + STUBS + (corrupt ? ROUND_TRIP : "") + MARKER + tail)

    get = File.join(@directory, "get.json")
    put = File.join(@directory, "put.json")
    metadata = { "revision" => revision }
    metadata["yaml"] = current unless current.nil?
    File.binwrite(get, JSON.generate(metadata))
    environment = { "STUB_TOKEN" => "t" * 40, "STUB_GET" => get, "STUB_PUT" => put }

    reader, writer = IO.pipe
    pid = Process.spawn(environment, RbConfig.ruby, harness, *arguments, out: writer, err: writer)
    writer.close
    output = reader.read.force_encoding(Encoding::UTF_8)
    reader.close
    _, status = Process.waitpid2(pid)
    uploaded = File.exist?(put) ? JSON.parse(File.binread(put).force_encoding(Encoding::UTF_8)) : nil
    [status.exitstatus, output, uploaded]
  end

  def test_dry_run_reports_the_placeholders_it_found
    code, output, uploaded = run_publisher(["--dry-run", source("new.yaml", NEW_SOURCE)])
    assert_equal(0, code, output)
    assert_match(/Validated 1 uniquely named incoming nodes carrying 1 per-account identity placeholders/, output)
    assert_nil(uploaded)
  end

  def test_publish_keeps_source_text_verbatim
    path = source("new.yaml", NEW_SOURCE)
    code, output, uploaded = run_publisher(["--publish", path])
    assert_equal(0, code, output)
    yaml = uploaded.fetch("yaml")
    assert_equal(1, yaml.scan(PLACEHOLDER).length)
    assert_includes(yaml, "uuid: #{PLACEHOLDER}")
    refute_includes(yaml, "? TONO_CLIENT_UUID")
    # An all-digit short ID is an octal integer to the YAML parser, so a dump
    # would have written back 5744368105847.
    assert_includes(yaml, "short-id: 0123456701234567")
    assert_equal(["Singapore Reality"], YAML.safe_load(yaml).fetch("proxies").map { |node| node["name"] })
    assert_equal(7, uploaded.fetch("expectedRevision"))
  end

  def test_append_preserves_the_deployed_catalog_byte_for_byte
    code, output, uploaded = run_publisher(
      ["--append", source("new.yaml", NEW_SOURCE)],
      current: CURRENT_CATALOG,
      revision: 12
    )
    assert_equal(0, code, output)
    yaml = uploaded.fetch("yaml")
    assert(yaml.start_with?(CURRENT_CATALOG), "the deployed catalog text was rewritten instead of spliced")
    assert_equal(3, yaml.scan(PLACEHOLDER).length)
    assert_includes(yaml, "  - name: Singapore Reality\n    type: vless\n")
    assert_includes(yaml, "    reality-opts:\n      public-key: CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC\n")
    assert_equal(
      ["Los Angeles · Pacific", "Tokyo Reality", "Singapore Reality"],
      YAML.safe_load(yaml).fetch("proxies").map { |node| node["name"] }
    )
    assert_equal(12, uploaded.fetch("expectedRevision"))
    assert_match(/Appended and published 3 managed nodes/, output)
  end

  def test_append_lands_inside_the_list_and_keeps_the_rest_of_the_document
    current = "#{CURRENT_CATALOG}rules:\n  - MATCH,Tono\n"
    code, output, uploaded = run_publisher(
      ["--append", source("new.yaml", NEW_SOURCE)],
      current: current
    )
    assert_equal(0, code, output)
    yaml = uploaded.fetch("yaml")
    assert(yaml.start_with?("# Managed exit catalog."), "the leading comment was dropped")
    assert(yaml.end_with?("rules:\n  - MATCH,Tono\n"), "the trailing document sections were dropped")
    assert_operator(yaml.index("Singapore Reality"), :<, yaml.index("rules:"))
    assert_equal(3, yaml.scan(PLACEHOLDER).length)
  end

  def test_append_matches_the_indent_of_the_deployed_list
    current = CURRENT_CATALOG.split("\n", -1).map { |line| line.start_with?("  ") ? line[2..] : line }.join("\n")
    code, output, uploaded = run_publisher(
      ["--append", source("new.yaml", NEW_SOURCE)],
      current: current
    )
    assert_equal(0, code, output)
    yaml = uploaded.fetch("yaml")
    assert(yaml.start_with?(current), "the deployed catalog text was rewritten instead of spliced")
    assert_includes(yaml, "- name: Singapore Reality\n  type: vless\n")
    assert_equal(3, yaml.scan(PLACEHOLDER).length)
    assert_equal(3, YAML.safe_load(yaml).fetch("proxies").length)
  end

  def test_publish_combines_several_sources_including_a_flow_mapping_node
    flow = "proxies:\n  - {name: JP Reality, type: vless, uuid: #{PLACEHOLDER}, port: 443}\n"
    code, output, uploaded = run_publisher(
      ["--publish", source("new.yaml", NEW_SOURCE), source("flow.yaml", flow)]
    )
    assert_equal(0, code, output)
    yaml = uploaded.fetch("yaml")
    assert_equal(2, yaml.scan(PLACEHOLDER).length)
    assert_includes(yaml, "  - {name: JP Reality, type: vless, uuid: #{PLACEHOLDER}, port: 443}")
    assert_equal(
      ["Singapore Reality", "JP Reality"],
      YAML.safe_load(yaml).fetch("proxies").map { |node| node["name"] }
    )
  end

  def test_publish_refuses_null_missing_and_decoy_identities
    invalid_sources = {
      "null.yaml" => NEW_SOURCE.sub("uuid: #{PLACEHOLDER}", "uuid: null"),
      "missing.yaml" => NEW_SOURCE.sub("  uuid: #{PLACEHOLDER}\n", "  # #{PLACEHOLDER}\n"),
      "flow.yaml" => "proxies:\n  - {name: Broken, type: vless, uuid: null} # #{PLACEHOLDER}\n",
    }
    invalid_sources.each do |name, content|
      code, output, uploaded = run_publisher(["--publish", source(name, content)])
      assert_equal(1, code, output)
      assert_match(/exactly one per-account uuid placeholder/, output)
      assert_nil(uploaded)
    end
  end

  def test_publish_refuses_a_source_whose_parse_and_text_disagree
    # `YAML.safe_load` takes the last of two top-level `proxies:` keys; the text
    # scan takes the first. Every name check — including the append path's
    # duplicate refusal — would then run against a list that is not the one
    # published.
    decoy = "#{NEW_SOURCE}rules:\n  - MATCH,Tono\nproxies:\n  - name: Decoy\n    uuid: #{PLACEHOLDER}\n"
    code, output, uploaded = run_publisher(["--publish", source("decoy.yaml", decoy)])
    assert_equal(1, code, output)
    assert_match(/The combined catalog is not a valid proxies document\./, output)
    assert_nil(uploaded)
  end

  def test_append_keeps_the_comments_that_open_and_close_the_list
    current = <<~YAML
      # Managed exit catalog.
      proxies:
        # Los Angeles region
        - name: LA
          uuid: #{PLACEHOLDER}
      # end of the managed list
      rules:
        - MATCH,Tono
    YAML
    code, output, uploaded = run_publisher(
      ["--append", source("new.yaml", NEW_SOURCE)],
      current: current
    )
    assert_equal(0, code, output)
    yaml = uploaded.fetch("yaml")
    assert_includes(yaml, "  # Los Angeles region\n", "the comment opening the list was dropped")
    # The comment closes the list, so the appended node belongs above it.
    assert_operator(yaml.index("Singapore Reality"), :<, yaml.index("# end of the managed list"))
    assert_equal(2, yaml.scan(PLACEHOLDER).length)
    assert_equal(["LA", "Singapore Reality"], YAML.safe_load(yaml).fetch("proxies").map { |node| node["name"] })
    assert(yaml.end_with?("rules:\n  - MATCH,Tono\n"))
  end

  def test_a_catalog_with_no_list_to_splice_round_trips_unchanged
    current = "# only a comment list\nproxies:\n  - name: LA\n    uuid: #{PLACEHOLDER}\n"
    code, output, uploaded = run_publisher(
      ["--append", source("new.yaml", NEW_SOURCE)],
      current: current
    )
    assert_equal(0, code, output)
    assert(uploaded.fetch("yaml").start_with?(current), "the deployed catalog text was rewritten")
  end

  def test_append_refuses_when_the_outgoing_catalog_loses_placeholders
    code, output, uploaded = run_publisher(
      ["--append", source("new.yaml", NEW_SOURCE)],
      current: CURRENT_CATALOG,
      corrupt: true
    )
    assert_equal(1, code, output)
    assert_match(/Refusing to publish: the catalog to upload carries 0 #{Regexp.escape(PLACEHOLDER)} tokens but 3/, output)
    assert_match(/per-account/, output)
    assert_nil(uploaded, "a catalog that lost its identity placeholders was uploaded")
  end

  def test_publish_refuses_when_the_outgoing_catalog_loses_placeholders
    code, output, uploaded = run_publisher(["--publish", source("new.yaml", NEW_SOURCE)], corrupt: true)
    assert_equal(1, code, output)
    assert_match(/Refusing to publish: the catalog to upload carries 0 #{Regexp.escape(PLACEHOLDER)} tokens but 1/, output)
    assert_nil(uploaded)
  end

  def test_append_still_refuses_a_duplicate_name
    duplicate = NEW_SOURCE.sub("Singapore Reality", "Tokyo Reality")
    code, output, uploaded = run_publisher(
      ["--append", source("dup.yaml", duplicate)],
      current: CURRENT_CATALOG
    )
    assert_equal(1, code, output)
    assert_match(/Append would duplicate an existing managed node name: Tokyo Reality/, output)
    assert_nil(uploaded)
  end

  def test_the_round_trip_this_publisher_avoids_really_destroys_the_placeholder
    document = YAML.safe_load(CURRENT_CATALOG, permitted_classes: [], permitted_symbols: [], aliases: false)
    dumped = YAML.dump(document)
    assert_equal(2, CURRENT_CATALOG.scan(PLACEHOLDER).length)
    assert_equal(0, dumped.scan(PLACEHOLDER).length)
    assert_match(/^\s+uuid:\s*$/, dumped)
  end
end
