#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "net/http"
require "openssl"
require "open3"
require "optparse"
require "uri"
require "yaml"

CONTROL_PLANE_ORIGIN = "https://api.afk.ccwu.cc"
KEYCHAIN_SERVICE = "com.raydocs.tono.staging.admin-api-token"
CLIENT_UUID_PLACEHOLDER = "{{TONO_CLIENT_UUID}}"
CATALOG_ITEM_INDENT = 2
MAXIMUM_YAML_BYTES = 1024 * 1024
MAXIMUM_RESPONSE_BYTES = 2 * 1024 * 1024

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
  # credential-bearing catalog upload through another process.
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
  fail!("The control-plane catalog request failed with HTTP #{response.code}.") unless response.is_a?(Net::HTTPSuccess)
  JSON.parse(bounded_response(response))
rescue JSON::ParserError
  fail!("The control plane returned invalid JSON.")
end

def placeholder_count(text)
  text.scan(CLIENT_UUID_PLACEHOLDER).length
end

def managed_identity_block?(block)
  uuid_keys = block.scan(/^\s*(?:-\s*)?uuid\s*:/).length +
              block.scan(/[{,]\s*uuid\s*:/).length
  return false unless uuid_keys == 1

  placeholder = Regexp.escape(CLIENT_UUID_PLACEHOLDER)
  scalar = /(?:["']#{placeholder}["']|#{placeholder})/
  block.match?(/^\s*(?:-\s*)?uuid\s*:\s*#{scalar}\s*(?:#.*)?$/) ||
    block.match?(/[{,]\s*uuid\s*:\s*#{scalar}\s*(?=[,}])/)
end

# Parses a throwaway copy purely to read structure. Nothing this returns is ever
# written back into a catalog: "{{TONO_CLIENT_UUID}}" is a valid YAML flow
# mapping, so a load/dump round trip rewrites every per-account identity into a
# nested key and leaves the uuid line empty.
def catalog_nodes(text)
  document = YAML.safe_load(
    text.dup,
    permitted_classes: [],
    permitted_symbols: [],
    aliases: false
  )
  document.is_a?(Hash) ? document["proxies"] : nil
end

# Locates the proxies list in catalog text and returns the text before it, one
# verbatim text block per list item, the item indent, and the text after it.
# Returns nil when there is no top-level proxies list to edit as text.
def split_catalog(text)
  lines = text.gsub("\r\n", "\n").split("\n", -1)
  header = lines.index { |line| line.match?(/\Aproxies\s*:\s*(?:\[\s*\]\s*)?(?:#.*)?\z/) }
  return nil if header.nil?

  if lines[header].match?(/\Aproxies\s*:\s*\[\s*\]/)
    prefix = (lines[0...header] + ["proxies:"]).join("\n")
    return { prefix: "#{prefix}\n", blocks: [], indent: nil, suffix: lines[(header + 1)..].join("\n") }
  end

  item_indent = nil
  starts = []
  list_end = lines.length
  ((header + 1)...lines.length).each do |index|
    line = lines[index]
    next if line.strip.empty? || line.match?(/\A\s*#/)
    indent = line[/\A */].length
    if indent.zero? && !line.lstrip.start_with?("-")
      list_end = index
      break
    end
    next unless line.match?(/\A\s*-\s+/)
    item_indent ||= indent
    starts << index if indent == item_indent
  end

  # Anything written between the header and the first item, and any comment or
  # blank line that closes the list after the last item, belongs to the document
  # rather than to an item. Held in the prefix and the suffix, it survives an
  # append verbatim and the new nodes land inside the list rather than below a
  # line that terminates it.
  prefix_end = starts.empty? ? header : starts.first - 1
  tail = list_end
  while starts.any? && tail > starts.last + 1 &&
        (lines[tail - 1].strip.empty? || lines[tail - 1].lstrip.start_with?("#"))
    tail -= 1
  end

  blocks = starts.each_with_index.map do |start, position|
    stop = position + 1 < starts.length ? starts[position + 1] : tail
    lines[start...stop].join("\n").sub(/\s+\z/, "")
  end
  {
    prefix: "#{lines[0..prefix_end].join("\n")}\n",
    blocks: blocks,
    indent: item_indent,
    suffix: lines[tail..].join("\n"),
  }
end

# Shifts a whole item block by a fixed number of spaces so it can be spliced
# under a list written at a different indent. Relative indentation, and every
# byte that is not leading whitespace, is preserved.
def reindent_block(block, from, to)
  return block if from.nil? || to.nil? || from == to
  block.split("\n", -1).map do |line|
    next line if line.strip.empty?
    if to > from
      "#{" " * (to - from)}#{line}"
    else
      fail!("A catalog node uses indentation this tool cannot splice as text.") unless
        line.start_with?(" " * (from - to))
      line[(from - to)..]
    end
  end.join("\n")
end

def catalog_text(prefix, blocks, suffix)
  body = blocks.empty? ? "" : "#{blocks.join("\n")}\n"
  text = "#{prefix}#{body}#{suffix}"
  text << "\n" unless text.end_with?("\n")
  text
end

mode = :dry_run
parser = OptionParser.new do |options|
  options.banner = "Usage: publish-managed-catalog.rb [--dry-run|--publish|--append] /absolute/node-a.yaml [...]"
  options.on("--dry-run", "Validate and combine sources without Keychain or network access") { mode = :dry_run }
  options.on("--publish", "Replace the full catalog after validation; the default is dry-run") { mode = :publish }
  options.on("--append", "Fetch the current catalog and append uniquely named nodes") { mode = :append }
end
begin
  parser.parse!(ARGV)
rescue OptionParser::ParseError => error
  fail!(error.message)
end

token = nil
yaml = nil
begin
fail!(parser.banner) if ARGV.empty?

names = []
incoming_blocks = []
added_placeholders = 0
ARGV.each do |path|
  fail!("Every catalog source must use an absolute path.") unless path.start_with?("/")
  stat = File.lstat(path)
  fail!("Catalog sources must be regular files, not symlinks.") unless stat.file? && !stat.symlink?
  fail!("Catalog sources must be owned by the current user.") unless stat.uid == Process.uid
  fail!("Catalog sources must not be group/world accessible.") unless (stat.mode & 0o077).zero?
  fail!("Each catalog source must be 1 byte–1 MiB.") unless stat.size.positive? && stat.size <= MAXIMUM_YAML_BYTES

  content = File.binread(path).force_encoding(Encoding::UTF_8)
  fail!("Catalog sources must be valid UTF-8.") unless content.valid_encoding?
  nodes = catalog_nodes(content)
  fail!("Every catalog source must contain a non-empty proxies array.") unless nodes.is_a?(Array) && !nodes.empty?
  source = split_catalog(content)
  fail!("Every catalog source must contain a proxies list this tool can edit as text.") if source.nil?
  fail!("A catalog source's proxies list does not match its parsed node count.") unless
    source[:blocks].length == nodes.length
  fail!("Every managed node must have exactly one per-account uuid placeholder.") unless
    source[:blocks].all? { |block| managed_identity_block?(block) }
  names.concat(nodes.map { |node| node.is_a?(Hash) ? node["name"] : nil })
  added_placeholders += source[:blocks].sum { |block| placeholder_count(block) }
  source[:blocks].each do |block|
    incoming_blocks << reindent_block(block, source[:indent], CATALOG_ITEM_INDENT)
  end
rescue Errno::ENOENT, Errno::EACCES, Psych::Exception => error
  fail!("Could not safely parse a catalog source (#{error.class}).")
end

fail!("Every managed node needs a non-empty string name.") unless names.all? { |name| name.is_a?(String) && !name.empty? }
fail!("Managed node names must be unique.") unless names.uniq.length == names.length

# The catalog is assembled by concatenating the source text, never by dumping a
# parsed document, so every per-account identity placeholder survives byte for
# byte. added_placeholders and kept_placeholders back the invariant asserted
# before the upload.
kept_placeholders = 0
yaml = catalog_text("proxies:\n", incoming_blocks, "")
fail!("Combined catalog exceeds 1 MiB.") if yaml.bytesize > MAXIMUM_YAML_BYTES
begin
  combined = catalog_nodes(yaml)
rescue Psych::Exception
  combined = nil
end
# Names, not a count. The names were validated against a parse of each source,
# and the text was spliced out of the same sources by a separate scan; a source
# the two read differently — a second top-level `proxies:` key, say — would pass
# a count check while publishing a list nothing checked.
fail!("The combined catalog is not a valid proxies document.") unless
  combined.is_a?(Array) &&
  combined.map { |node| node.is_a?(Hash) ? node["name"] : nil } == names

if mode == :dry_run
  puts(
    "Validated #{names.length} uniquely named incoming nodes carrying #{added_placeholders} " \
    "per-account identity placeholders; no credentials or network were used."
  )
  exit(0)
end

token, status = Open3.capture2(
  "/usr/bin/security",
  "find-generic-password",
  "-s",
  KEYCHAIN_SERVICE,
  "-w"
)
token = token.strip
fail!("The staging admin token is unavailable in Keychain.") unless status.success? && token.bytesize >= 32

origin = URI(CONTROL_PLANE_ORIGIN)
fail!("Invalid fixed control-plane origin.") unless origin.scheme == "https" && origin.port == 443 && origin.userinfo.nil?
catalog_uri = origin + "/api/v1/admin/exit-catalog"

metadata = request(catalog_uri, token, Net::HTTP::Get)
fail!("The control plane returned invalid catalog metadata.") unless metadata.is_a?(Hash)
revision = metadata["revision"]
fail!("The control plane returned an invalid catalog revision.") unless revision.is_a?(Integer) && revision >= 0

if mode == :append
  current_yaml = metadata["yaml"]
  fail!("The control plane does not support safe catalog append; deploy the matching Worker first.") unless
    current_yaml.is_a?(String) && current_yaml.bytesize <= MAXIMUM_YAML_BYTES
  begin
    current_proxies = catalog_nodes(current_yaml)
  rescue Psych::Exception
    fail!("The current managed catalog is invalid YAML; refusing to append.")
  end
  fail!("The current managed catalog does not contain a proxies array.") unless current_proxies.is_a?(Array)
  current_names = current_proxies.map { |node| node.is_a?(Hash) ? node["name"] : nil }
  fail!("The current managed catalog has invalid node names.") unless
    current_names.all? { |name| name.is_a?(String) && !name.empty? } && current_names.uniq.length == current_names.length
  duplicates = current_names & names
  fail!("Append would duplicate an existing managed node name: #{duplicates.first}") unless duplicates.empty?

  # The deployed catalog is spliced, not re-emitted: its own text is kept
  # verbatim and the new nodes are concatenated after the last list item.
  current = split_catalog(current_yaml)
  fail!("The current managed catalog has no proxies list this tool can edit as text; refusing to append.") if current.nil?
  fail!("The current managed catalog's proxies list does not match its parsed node count; refusing to append.") unless
    current[:blocks].length == current_proxies.length
  fail!("The current managed catalog has a node without exactly one per-account uuid placeholder; refusing to append.") unless
    current[:blocks].all? { |block| managed_identity_block?(block) }
  kept_placeholders = current[:blocks].sum { |block| placeholder_count(block) }
  appended_blocks = incoming_blocks.map do |block|
    reindent_block(block, CATALOG_ITEM_INDENT, current[:indent] || CATALOG_ITEM_INDENT)
  end
  yaml = catalog_text(current[:prefix], current[:blocks] + appended_blocks, current[:suffix])
  fail!("Combined catalog exceeds 1 MiB.") if yaml.bytesize > MAXIMUM_YAML_BYTES
  begin
    combined = catalog_nodes(yaml)
  rescue Psych::Exception
    combined = nil
  end
  names = current_names + names
  fail!("The appended catalog is not a valid proxies document.") unless
    combined.is_a?(Array) &&
    combined.map { |node| node.is_a?(Hash) ? node["name"] : nil } == names
end

# The identity placeholder is what makes the served catalog per-account. Anything
# that rewrote the document instead of splicing it would silently drop tokens
# here; keep the publisher's local refusal as a first line of defence before the
# control plane independently validates the upload.
expected_placeholders = kept_placeholders + added_placeholders
outgoing_placeholders = placeholder_count(yaml)
unless outgoing_placeholders == expected_placeholders
  fail!(
    "Refusing to publish: the catalog to upload carries #{outgoing_placeholders} #{CLIENT_UUID_PLACEHOLDER} " \
    "tokens but #{expected_placeholders} were expected (#{kept_placeholders} kept from the deployed catalog " \
    "plus #{added_placeholders} from the sources). Publishing it would strip per-account identities and leave " \
    "every account sharing one empty identity with no per-account metering."
  )
end
outgoing = split_catalog(yaml)
unless outgoing && outgoing[:blocks].all? { |block| managed_identity_block?(block) }
  fail!("Refusing to publish: every managed node must keep exactly one per-account uuid placeholder.")
end

result = request(
  catalog_uri,
  token,
  Net::HTTP::Put,
  JSON.generate({ yaml: yaml, expectedRevision: revision })
)
new_revision = result["revision"]
digest = result["sha256"]
fail!("The control plane returned invalid replacement metadata.") unless new_revision == revision + 1 && digest.is_a?(String)

verb = mode == :append ? "Appended and published" : "Published"
puts("#{verb} #{names.length} managed nodes as control-plane catalog revision #{new_revision}; secrets were not printed or written.")
ensure
  metadata_yaml = metadata.is_a?(Hash) ? metadata["yaml"] : nil
  metadata_yaml&.replace("\0" * metadata_yaml.bytesize)
  token&.replace("\0" * token.bytesize)
  yaml&.replace("\0" * yaml.bytesize)
end
