#!/usr/bin/env ruby
# Exercise the actual shell gate, without signing credentials or a GitHub runner.
require 'yaml'
require 'open3'
require 'json'
require 'digest'
require 'fileutils'
require 'tmpdir'

root = File.expand_path('../../..', __dir__)
workflow = YAML.load_file(File.join(root, '.github/workflows/macos-release.yml'))
trigger = workflow['on'] || workflow[true] # Psych may apply YAML 1.1 boolean keys.
input = trigger.fetch('workflow_dispatch').fetch('inputs').fetch('candidate_only')
abort 'candidate signing must be explicit and default off' unless input['type'] == 'boolean' && input['default'] == false
abort 'candidate workflow must not gain release-write permissions' unless workflow['permissions'] == { 'contents' => 'read' }
gate = workflow.fetch('jobs').fetch('branch').fetch('steps').first.fetch('run')
candidate_env = workflow.fetch('env', {})
cases = [
  ['true', 'branch', 'refs/heads/stability/desktop-0.0.74-20260926', true],
  ['true', 'branch', 'refs/heads/stability/desktop-0.0.73-20260922', false],
  ['true', 'branch', 'refs/heads/stability/desktop-0.0.74-20260926-unreviewed', false],
  ['true', 'branch', 'refs/pull/276/merge', false],
  ['true', 'branch', 'refs/heads/main', false],
  ['true', 'branch', 'refs/heads/release/macos', false],
  ['true', 'tag', 'refs/tags/tono-macos-0.0.74-build74', false],
  ['false', 'branch', 'refs/heads/release/macos', true],
  ['false', 'branch', 'refs/heads/main', false],
  ['false', 'branch', 'refs/heads/stability/desktop-0.0.74-20260926', false],
  ['false', 'tag', 'refs/tags/tono-macos-0.0.74-build74', false],
]
cases.each do |candidate, type, ref, expected|
  output, status = Open3.capture2e(
    candidate_env.merge('CANDIDATE_ONLY' => candidate, 'GITHUB_REF_TYPE' => type, 'GITHUB_REF' => ref,
                        'UPDATE_RELEASE_SEQUENCE' => '7401'),
    '/bin/bash', '-c', gate
  )
  abort "wrong branch admission: #{candidate} #{ref}\n#{output}" unless status.success? == expected
end

# A release build with no v1 installed floor ships bytes every later v1 update refuses
# (UpdatePackage.swift), so both release workflows must stop at the ref gate instead.
{ 'macos-release.yml' => { 'CANDIDATE_ONLY' => 'false', 'GITHUB_REF' => 'refs/heads/release/macos' },
  'windows-release.yml' => { 'GITHUB_REF' => 'refs/heads/release/windows' } }.each do |name, ref_env|
  release = YAML.load_file(File.join(root, '.github/workflows', name))
  step = release.fetch('jobs').fetch('branch').fetch('steps').first
  literal = step.fetch('env', {}).reject { |_, value| value.to_s.include?('${{') }
  env = release.fetch('env', {}).merge(literal).merge(ref_env).merge('GITHUB_REF_TYPE' => 'branch')
  _, status = Open3.capture2e(env.merge('UPDATE_RELEASE_SEQUENCE' => ''), '/bin/bash', '-c', step.fetch('run'))
  abort "#{name} admitted a release build without update_release_sequence" if status.success?
  output, status = Open3.capture2e(env.merge('UPDATE_RELEASE_SEQUENCE' => '7401'), '/bin/bash', '-c', step.fetch('run'))
  abort "#{name} refused a release build with a sequence:\n#{output}" unless status.success?
  abort "#{name} gate must read the dispatch input" unless step.fetch('env', {})['UPDATE_RELEASE_SEQUENCE'] == "${{ inputs.update_release_sequence || '' }}"
end
puts 'release workflows: an empty update_release_sequence is refused before any build'
appcast = workflow.fetch('jobs').fetch('validate-appcast')
expected_guard = "${{ !(github.event_name == 'workflow_dispatch' && inputs.candidate_only) }}"
abort 'candidate must not enter the Sparkle-key environment' unless appcast['if'] == expected_guard
abort 'appcast environment must retain its existing gate' unless appcast['environment'] == 'macos-appcast'
puts "macOS candidate workflow: #{cases.length} branch cases and update-authority guards passed"

# The signing utility is independent of the removed App runtime dependency.
# Execute the actual workflow shell with corrupt downloaded bytes; extraction
# and executable discovery must never run before the checksum succeeds.
signer_step = appcast.fetch('steps').find { |step| step['name'] == 'Locate the pinned Sparkle 2.9.6 sign_update tool' }.fetch('run')
abort 'signer must not depend on the App package graph' if signer_step.include?('resolvePackageDependencies')
abort 'signer archive pin must match Sparkle 2.9.6 Package.swift' unless signer_step.include?('8d5fb41d960b43f4a68aa14126bf62b098544ec8d191cdcc73eb14e63a8e7606')
Dir.mktmpdir('tono-signer-pin-') do |directory|
  stub = <<~SH
    curl() {
      while [ "$#" -gt 0 ]; do
        if [ "$1" = --output ]; then shift; printf 'corrupt archive' > "$1"; return 0; fi
        shift
      done
      return 1
    }
    ditto() { touch "$RUNNER_TEMP/extraction-was-reached"; }
  SH
  _, status = Open3.capture2e({ 'RUNNER_TEMP' => directory }, '/bin/bash', '-c', stub + signer_step, chdir: root)
  abort 'signer download accepted changed bytes' if status.success?
  abort 'unverified signer archive was extracted' if File.exist?(File.join(directory, 'extraction-was-reached'))
end
puts 'independent Sparkle signer: corrupted download refuses before extraction (no keys or network)'

# Execute both remaining production candidate boundaries, not just the first ref gate.
build_steps = workflow.fetch('jobs').fetch('build').fetch('steps')
source_gate = build_steps.find { |step| step['name'] == 'Require the macOS release line' }.fetch('run')
source, status = Open3.capture2e('git', 'rev-parse', 'HEAD', chdir: root)
abort 'cannot resolve the actual test checkout' unless status.success?
source = source.strip
environment = candidate_env.merge('CANDIDATE_ONLY' => 'true', 'GITHUB_SHA' => source,
                                  'GITHUB_REF' => 'refs/heads/stability/desktop-0.0.74-20260926')
output, status = Open3.capture2e(environment, '/bin/bash', '-c', source_gate, chdir: root)
abort "0.0.74 source must pass the second candidate gate:\n#{output}" unless status.success?
_, status = Open3.capture2e(environment.merge('GITHUB_SHA' => '0' * 40), '/bin/bash', '-c', source_gate, chdir: root)
abort 'candidate gate accepted a different source checkout' if status.success?

manifest_step = build_steps.find { |step| step['name'] == 'Record signed candidate provenance without update authority' }
abort 'candidate provenance must stay candidate-only' unless manifest_step['if'] == "github.event_name == 'workflow_dispatch' && inputs.candidate_only"
signing_index = build_steps.index { |step| step['name'] == 'Build, sign and notarize the release archive' }
abort 'candidate provenance must follow signing/notarization verification' unless signing_index && build_steps.index(manifest_step) > signing_index
Dir.mktmpdir('tono-candidate-manifest-') do |directory|
  name = 'Tono-0.0.74-build74-arm64'
  release = File.join(directory, 'release')
  contents = File.join(release, name + '.app', 'Contents')
  files = [name + '.zip', name + '.app/Contents/MacOS/Tono',
           name + '.app/Contents/Resources/tono-core-helper', name + '.app/Contents/Resources/sing-box']
  files.each do |relative|
    path = File.join(release, relative)
    FileUtils.mkdir_p(File.dirname(path))
    File.write(path, "synthetic manifest fixture: #{relative}")
  end
  plist = <<~PLIST
    <?xml version="1.0" encoding="UTF-8"?>
    <plist version="1.0"><dict>
    <key>CFBundleShortVersionString</key><string>0.0.74</string>
    <key>CFBundleVersion</key><string>74</string>
    </dict></plist>
  PLIST
  File.write(File.join(contents, 'Info.plist'), plist)
  manifest_env = environment.merge('RUNNER_TEMP' => directory, 'ARTIFACT_NAME' => name)
  output, status = Open3.capture2e(manifest_env, '/bin/bash', '-c', manifest_step.fetch('run'))
  abort "0.0.74 artifact must pass the candidate manifest boundary:\n#{output}" unless status.success?
  report = JSON.parse(File.read(File.join(release, 'candidate-manifest.json')))
  abort 'manifest must describe actual 0.0.74/build74 bytes and source' unless report.values_at('version', 'build', 'source') == ['0.0.74', 74, source]
  abort 'candidate must not claim release or Sparkle authority' unless report.values_at('candidateOnly', 'releaseAccepted', 'sparkleSigned') == [true, false, false]
  expected_files = files.map { |relative| { 'name' => relative, 'sha256' => Digest::SHA256.file(File.join(release, relative)).hexdigest } }
  abort 'candidate manifest must fingerprint every shipped component' unless report['files'] == expected_files
  # Signing is NOT exercised here. Old bundle identity must fail before a new receipt is written.
  File.write(File.join(contents, 'Info.plist'), plist.sub('0.0.74', '0.0.73').sub('>74<', '>73<'))
  _, status = Open3.capture2e(manifest_env, '/bin/bash', '-c', manifest_step.fetch('run'))
  abort 'candidate manifest accepted stale 0.0.73 artifact bytes' if status.success?
end
puts 'macOS 0.0.74 candidate: exact checkout, source version, bundle identity and manifest digests verified (synthetic, unsigned fixtures)'

# Signing material and the token reach only the steps that use them.
signing_secret = /secrets\.(MACOS_DEVELOPER_ID_|APPLE_NOTARY_|MACOS_KEYCHAIN_|SPARKLE_ED_)/
abort 'signing secrets must not be injected at workflow level' if workflow.fetch('env', {}).to_s.match?(signing_secret)
workflow.fetch('jobs').each do |id, job|
  abort "#{id} must not inject signing secrets at job level" if job.fetch('env', {}).to_s.match?(signing_secret)
  abort "#{id} must not gain write permissions" if job.fetch('permissions', {}).to_s.include?('write')
  job.fetch('steps', []).each do |step|
    next unless step.fetch('uses', '').start_with?('actions/checkout@')
    abort "#{id} checkout must not persist the token in .git/config" unless step.fetch('with', {})['persist-credentials'] == false
  end
end
puts 'macOS release secrets: step-scoped only; no write permission; checkouts do not persist credentials'

# Reusable qualification and its caller share one immutable artifact namespace.
qualification = YAML.load_file(File.join(root, workflow.fetch('jobs').fetch('qualify').fetch('uses')))
core_uploads = [qualification, workflow].flat_map do |config|
  config.fetch('jobs').values.flat_map { |job| job.fetch('steps', []) }.select do |step|
    step.fetch('uses', '').start_with?('actions/upload-artifact@') && step.fetch('with', {})['name'] == 'sing-box-darwin-arm64'
  end
end
abort 'release must use the qualified Core artifact, not upload the same immutable name twice' unless core_uploads.length == 1
puts 'macOS release Core input: one immutable artifact shared with qualification'

steps = appcast.fetch('steps')
export_step = steps.find { |step| step['name'] == 'Export public signature and provenance for physical acceptance' }
abort 'public release proof must be exported, not signing material' unless export_step && export_step.fetch('with').fetch('path').lines.map(&:strip) == [
  '${{ runner.temp }}/enclosure.sig', '${{ runner.temp }}/release-receipt.json'
]
validation_index = steps.index { |step| step['name'] == 'Validate the appcast entry against the exact bytes users download' }
abort 'proof export must follow actual signature validation without always()' unless validation_index && steps.index(export_step) > validation_index && !export_step.key?('if')
puts 'macOS release proof: only public signature/receipt, after validation, under existing environment gate'

validation = steps.fetch(validation_index).fetch('run')
pipeline = validation[/node tooling\/scripts\/publish-macos-appcast\.mjs.*?\| tee [^\n]+/m]
abort 'missing actual appcast validation pipeline' unless pipeline
Dir.mktmpdir('tono-appcast-failure-test-') do |directory|
  variables = pipeline.scan(/\$([A-Za-z_][A-Za-z0-9_]*)/).flatten.uniq.to_h { |name| [name, 'fixture'] }
  variables['RUNNER_TEMP'] = directory
  [0, 42].each do |exit_code|
    script = validation.lines.first + "node() { return #{exit_code}; };\n" + pipeline
    _, result = Open3.capture2e(variables, '/bin/bash', '-c', script)
    abort "appcast validation failure was masked by tee: #{exit_code} => #{result.exitstatus}" unless result.exitstatus == exit_code
  end
end
abort 'release URL must use the publisher default download host' unless File.read(File.join(root, '.github/workflows/macos-release.yml')).include?('enclosure_url=https://releases.afk.ccwu.cc/download/')
puts 'macOS appcast pipeline: success and failure exit codes propagate; canonical download host'
