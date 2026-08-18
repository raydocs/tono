#!/usr/bin/env ruby
# frozen_string_literal: true

# Moves the Feishu/Lark and Bilibili domain families in the managed traffic
# policy from `webDomains` (exact-host pins that need a DNS answer and a PF
# endpoint permit) to `directSuffixes` (DOMAIN-SUFFIX matching, no DNS
# dependency).
#
# Why: an exact pin covers only the apex, while a CDN serves from
# `*.feishucdn.com`, so the pinned route never matched the real traffic. On top
# of that, `feishucdn.com` resolved to zero A records on 80 of 80 attempts
# (`managed_direct_answers_filtered`), leaving the policy permanently
# part-applied and burning the whole DNS retry ladder on every connect.
#
# The clients now handle this asymmetrically. macOS renders the reviewed
# suffixes through its interface-bound fallback group and arms a bounded PF
# port permit. Windows currently emits only the Bilibili family, and only when
# a signed reviewed native-app path has staged the matching WFP port permit;
# other accepted suffixes remain tunnelled there. Do not read a successful
# policy write as proof that every platform will route every suffix directly.
# Before that contract existed, a suffix route produced no `sessionEndpoints`
# entry and PF's block-all floor dropped the dial. That historical failure is
# why the Windows client keeps its suffix allowlist deliberately narrow.

require "json"
require "net/http"
require "openssl"
require "open3"
require "optparse"
require "uri"

CONTROL_PLANE_ORIGIN = "https://api.afk.ccwu.cc"
KEYCHAIN_SERVICE = "com.raydocs.tono.staging.admin-api-token"
MAXIMUM_RESPONSE_BYTES = 2 * 1024 * 1024

# Apex suffixes to introduce, each of which must also appear in the Worker's
# `allowedDirectSuffixes` — the Worker is the authority and rejects anything
# else with HTTP 400 before writing. Every `webDomains` entry at or under one of
# these apexes is retired, including `www.` forms: once the apex is a
# DOMAIN-SUFFIX entry it already covers every subdomain, and the control plane
# only accepts apex-shaped hosts in `directSuffixes`.
#
# Measured 2026-08-11 with the tunnel up: `www.bilibili.com` matched
# `(Domain,www.bilibili.com)` and went direct, while `i0/i1/s1/static.hdslb.com`
# matched no rule at all and fell through to the catch-all proxy — that is B
#站's entire static/image CDN. `vd3.bdstatic.com` matched
# `(DomainSuffix,bdstatic.com)` and went direct, which is the proof that suffix
# entries do cover subdomains. Exact pins cannot, and CDNs live on subdomains.
#
# Only `webDomains` is retargeted. The WeChat set lives in `domains`, whose
# rules additionally match PROCESS-PATH-REGEX; turning those into suffixes would
# drop the process gate and let any app reach WeChat's CDNs directly, which is a
# scope decision rather than a routing fix.
DEFAULT_SUFFIXES = [
  "bilibili.com",
  "hdslb.com",
  "bilivideo.com",
  "biliapi.net",
  "feishu.cn",
  "feishucdn.com",
  "larksuite.com",
  "larkoffice.com",
].freeze

def fail!(message)
  warn(message)
  exit(1)
end

def bounded_response(response)
  body = response.body || ""
  fail!("The control plane returned an oversized response.") if body.bytesize > MAXIMUM_RESPONSE_BYTES
  body
end

def request(uri, token, method, body = nil)
  # Explicit nil proxy prevents HTTP(S)_PROXY from redirecting a
  # credential-bearing policy write through another process.
  http = Net::HTTP.new(uri.host, uri.port, nil)
  http.use_ssl = true
  http.verify_mode = OpenSSL::SSL::VERIFY_PEER
  http.open_timeout = 10
  http.read_timeout = 30
  request = method.new(uri)
  request["Accept"] = "application/json"
  request["Authorization"] = "Bearer #{token}"
  if body
    request["Content-Type"] = "application/json"
    request.body = body
  end
  response = http.request(request)
  unless response.is_a?(Net::HTTPSuccess)
    fail!("The traffic-policy request failed with HTTP #{response.code}: #{bounded_response(response)[0, 400]}")
  end
  JSON.parse(bounded_response(response))
rescue JSON::ParserError
  fail!("The control plane returned invalid JSON.")
end

# The control plane accepts only these ports for a direct suffix, so anything
# else has to surface during the dry run rather than as a production 400.
SUFFIX_PORTS = [80, 443].freeze

def canonical_ports(ports)
  values = Array(ports).select { |port| port.is_a?(Integer) && port.positive? && port <= 65_535 }
  values.uniq.sort
end

def suffix_ports!(host, ports)
  rejected = ports - SUFFIX_PORTS
  unless rejected.empty?
    fail!(
      "#{host} routes port(s) #{rejected.join(", ")}, which directSuffixes cannot express " \
      "(only #{SUFFIX_PORTS.join("/")}). Keep that host pinned or extend the control-plane allowlist first."
    )
  end
  ports
end

# Pure transform so the change can be reviewed and exercised without touching
# production. Returns [new_policy, report].
def retarget(policy, suffixes)
  fail!("The policy must be an object.") unless policy.is_a?(Hash)
  version = policy["version"]
  fail!("Only traffic-policy version 4 carries directSuffixes and tcpEndpoints.") unless version == 4

  web = Array(policy["webDomains"])
  existing_suffixes = Array(policy["directSuffixes"])

  covered = lambda do |host|
    suffixes.find { |sfx| host == sfx || host.end_with?(".#{sfx}") }
  end
  removed = web.select { |entry| covered.call(entry["host"].to_s) }
  # Introducing a suffix that has no webDomains entry is still meaningful: a CDN
  # apex may simply never have been pinned, which is how hdslb.com subdomains
  # ended up proxied.

  # Fold the ports of every removed host (including www. forms) into the apex
  # suffix so no port that used to be routed direct silently stops being.
  ports_for = {}
  removed.each do |entry|
    apex = covered.call(entry["host"].to_s)
    fail!("#{entry["host"]} has no apex among the requested suffixes.") unless apex
    ports_for[apex] = canonical_ports((ports_for[apex] || []) + canonical_ports(entry["ports"]))
  end

  kept_web = web.reject { |entry| covered.call(entry["host"].to_s) }
  suffixes.each { |sfx| ports_for[sfx] ||= [80, 443] }
  merged = existing_suffixes.each_with_object({}) { |entry, acc| acc[entry["host"]] = canonical_ports(entry["ports"]) }
  added = []
  ports_for.each do |host, ports|
    if merged.key?(host)
      merged[host] = canonical_ports(merged[host] + ports)
    else
      merged[host] = ports
      added << host
    end
  end
  ports_for.each_key { |host| suffix_ports!(host, merged[host]) }
  new_suffixes = merged.keys.sort.map { |host| { "host" => host, "ports" => merged[host] } }

  new_policy = policy.dup
  new_policy["webDomains"] = kept_web
  new_policy["directSuffixes"] = new_suffixes

  report = {
    removed_from_web_domains: removed.map { |e| "#{e["host"]} #{canonical_ports(e["ports"]).join(",")}" }.sort,
    added_to_direct_suffixes: added.sort.map { |host| "#{host} #{merged[host].join(",")}" },
    web_domains_count: [web.length, kept_web.length],
    direct_suffixes_count: [existing_suffixes.length, new_suffixes.length],
    untouched_keys: (policy.keys - %w[webDomains directSuffixes]).sort,
  }
  [new_policy, report]
end

mode = :dry_run
policy_file = nil
parser = OptionParser.new do |options|
  options.banner = "Usage: retarget-direct-suffixes.rb [--dry-run|--publish] [--policy-file /abs/policy.json] [apex-suffix ...]"
  options.on("--dry-run", "Print the transform without writing (default)") { mode = :dry_run }
  options.on("--publish", "Write the retargeted policy, guarded by expectedRevision") { mode = :publish }
  options.on("--policy-file PATH", "Read the policy from a file instead of the control plane (offline review)") do |path|
    fail!("--policy-file needs an absolute path.") unless path.start_with?("/")
    policy_file = path
  end
end
begin
  parser.parse!(ARGV)
rescue OptionParser::ParseError => error
  fail!(error.message)
end
fail!("--policy-file cannot be combined with --publish.") if policy_file && mode == :publish

if policy_file
  document = JSON.parse(File.binread(policy_file))
  policy = document["policy"] || document
  revision = document["revision"]
else
  token, status = Open3.capture2("/usr/bin/security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w")
  token = token.to_s.strip
  fail!("The staging admin token is unavailable in Keychain.") unless status.success? && token.bytesize >= 32

  origin = URI(CONTROL_PLANE_ORIGIN)
  fail!("Invalid fixed control-plane origin.") unless origin.scheme == "https" && origin.port == 443 && origin.userinfo.nil?
  policy_uri = origin + "/api/v1/admin/traffic-policy"

  current = request(policy_uri, token, Net::HTTP::Get)
  fail!("The control plane returned invalid policy metadata.") unless current.is_a?(Hash)
  revision = current["revision"]
  fail!("The control plane returned an invalid policy revision.") unless revision.is_a?(Integer) && revision >= 0
  policy = current["policy"] || (current["json"] && JSON.parse(current["json"]))
  fail!("The control plane response carried no readable policy.") unless policy.is_a?(Hash)
end

requested = ARGV.empty? ? DEFAULT_SUFFIXES : ARGV.map { |h| h.strip.downcase }
new_policy, report = retarget(policy, requested)

puts "traffic policy revision: #{revision.inspect}"
puts "webDomains:     #{report[:web_domains_count][0]} -> #{report[:web_domains_count][1]}"
puts "directSuffixes: #{report[:direct_suffixes_count][0]} -> #{report[:direct_suffixes_count][1]}"
puts "\nremoved from webDomains:"
report[:removed_from_web_domains].each { |line| puts "  - #{line}" }
puts "\nadded to directSuffixes:"
report[:added_to_direct_suffixes].each { |line| puts "  + #{line}" }
puts "\nuntouched policy keys: #{report[:untouched_keys].join(", ")}"

if mode == :dry_run
  puts "\n--- payload that --publish would send ---"
  puts JSON.pretty_generate({ "expectedRevision" => revision, "policy" => new_policy })
  puts "\nDry run only. Nothing was written. Re-run with --publish to apply."
  exit(0)
end

origin = URI(CONTROL_PLANE_ORIGIN)
policy_uri = origin + "/api/v1/admin/traffic-policy"
token, status = Open3.capture2("/usr/bin/security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w")
token = token.to_s.strip
fail!("The staging admin token is unavailable in Keychain.") unless status.success? && token.bytesize >= 32

written = request(
  policy_uri,
  token,
  Net::HTTP::Put,
  JSON.generate({ "expectedRevision" => revision, "policy" => new_policy })
)
new_revision = written["revision"]
fail!("The control plane did not report a new revision.") unless new_revision.is_a?(Integer) && new_revision > revision

verified = request(policy_uri, token, Net::HTTP::Get)
stored = verified["policy"] || (verified["json"] && JSON.parse(verified["json"]))
fail!("The stored policy could not be read back for verification.") unless stored.is_a?(Hash)
leftover = Array(stored["webDomains"]).map { |entry| entry["host"] } & RETIRED_WEB_HOSTS
fail!("Publish reported success but #{leftover.join(", ")} is still pinned.") unless leftover.empty?
missing = INTRODUCED_SUFFIXES - Array(stored["directSuffixes"]).map { |entry| entry["host"] }
fail!("Publish reported success but these suffixes are missing: #{missing.join(", ")}") unless missing.empty?

puts "\npublished revision #{new_revision} and verified the stored policy."
puts "Clients pick this up on their next catalog/policy sync; reconnect to apply it immediately."
