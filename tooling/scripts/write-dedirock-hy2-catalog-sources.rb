#!/usr/bin/env ruby
# frozen_string_literal: true

# Writes the five Dedirock hy2 catalog sources for
# `publish-managed-catalog.rb --append` after the hy2-filter Worker is live.
# Fingerprints are the public leaf SHA-256 already in docs/ops/transport-hy2.md.
# Grove keeps the US-VLESS-Reality wire name so it folds onto the TCP base.
# No identity secrets. Does not talk to the network.

CLIENT_UUID_PLACEHOLDER = "{{TONO_CLIENT_UUID}}"

# name, IPv4, lowercase SHA-256 fingerprint (no colons)
NODES = [
  ["niagara.yaml", "Buffalo · Niagara · hy2", "23.94.79.123",
   "1e5374a79bdb83b04c3d3c84722c03211d1c941c2de9f92431d2198ba7212cad"],
  ["erie.yaml", "Buffalo · Erie · hy2", "198.46.140.254",
   "4a66f10676ca881186be350d16b3f86cb36f9c896ef445a692d5cc0bc8b5b201"],
  ["sunset.yaml", "Los Angeles · Sunset · hy2", "192.236.205.232",
   "0ff3ab6b1bec3a3766f88955a84064ae73ea4724cb4d8602780e06dfbceceeb7"],
  ["mesa.yaml", "Los Angeles · Mesa · hy2", "107.174.123.27",
   "f59731347bf068d79f9d9e78c074e4686b981383a5c9029a5650e703e6afba41"],
  ["grove.yaml", "US-VLESS-Reality · hy2", "198.12.84.154",
   "a4a8308980004c8a5cda98597b87986671f230445df863c23d380f012c72f909"],
].freeze

def fail!(message)
  warn(message)
  exit(1)
end

dir = ARGV[0]
fail!("Usage: write-dedirock-hy2-catalog-sources.rb /absolute/empty-or-new-dir") if dir.nil? || ARGV.length != 1
fail!("The output directory must be an absolute path.") unless dir.start_with?("/")

if File.exist?(dir)
  fail!("The output directory must be a directory.") unless File.directory?(dir)
  fail!("The output directory must be empty.") unless Dir.empty?(dir)
else
  Dir.mkdir(dir, 0o700)
end
File.chmod(0o700, dir)
fail!("The output directory must be owned by the current user.") unless File.stat(dir).uid == Process.uid

NODES.each do |file, name, server, fingerprint|
  path = File.join(dir, file)
  body = <<~YAML
    proxies:
    - name: #{name}
      type: hysteria2
      server: #{server}
      port: 443
      password: "#{CLIENT_UUID_PLACEHOLDER}"
      sni: www.microsoft.com
      fingerprint: #{fingerprint}
      skip-cert-verify: false
  YAML
  File.binwrite(path, body)
  File.chmod(0o600, path)
end

puts("Wrote #{NODES.length} hy2 sources in #{dir}. Dry-run, then append only after GET /api/v1/health buildSha is not 2cef4eac:")
puts("  ruby tooling/scripts/publish-managed-catalog.rb --dry-run #{dir}/*.yaml")
puts("  ruby tooling/scripts/publish-managed-catalog.rb --append #{dir}/*.yaml")
