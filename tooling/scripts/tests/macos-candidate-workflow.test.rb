#!/usr/bin/env ruby
# Exercise the actual shell gate, without signing credentials or a GitHub runner.
require 'yaml'
require 'open3'

root = File.expand_path('../../..', __dir__)
workflow = YAML.load_file(File.join(root, '.github/workflows/macos-release.yml'))
trigger = workflow['on'] || workflow[true] # Psych may apply YAML 1.1 boolean keys.
input = trigger.fetch('workflow_dispatch').fetch('inputs').fetch('candidate_only')
abort 'candidate signing must be explicit and default off' unless input['type'] == 'boolean' && input['default'] == false
abort 'candidate workflow must not gain release-write permissions' unless workflow['permissions'] == { 'contents' => 'read' }
gate = workflow.fetch('jobs').fetch('branch').fetch('steps').first.fetch('run')
cases = [
  ['true', 'branch', 'refs/heads/stability/desktop-0.0.72-20260908', true],
  ['true', 'branch', 'refs/heads/main', false],
  ['true', 'branch', 'refs/heads/release/macos', false],
  ['true', 'tag', 'refs/tags/tono-macos-0.0.72-build72', false],
  ['false', 'branch', 'refs/heads/release/macos', true],
  ['false', 'branch', 'refs/heads/main', false],
  ['false', 'branch', 'refs/heads/stability/desktop-0.0.72-20260908', false],
  ['false', 'tag', 'refs/tags/tono-macos-0.0.72-build72', true],
]
cases.each do |candidate, type, ref, expected|
  output, status = Open3.capture2e(
    { 'CANDIDATE_ONLY' => candidate, 'GITHUB_REF_TYPE' => type, 'GITHUB_REF' => ref },
    '/bin/bash', '-c', gate
  )
  abort "wrong branch admission: #{candidate} #{ref}\n#{output}" unless status.success? == expected
end
appcast = workflow.fetch('jobs').fetch('validate-appcast')
expected_guard = "${{ !(github.event_name == 'workflow_dispatch' && inputs.candidate_only) }}"
abort 'candidate must not enter the Sparkle-key environment' unless appcast['if'] == expected_guard
abort 'appcast environment must retain its existing gate' unless appcast['environment'] == 'macos-appcast'
puts "macOS candidate workflow: #{cases.length} branch cases and update-authority guards passed"

steps = appcast.fetch('steps')
export_step = steps.find { |step| step['name'] == 'Export public signature and provenance for physical acceptance' }
abort 'public release proof must be exported, not signing material' unless export_step && export_step.fetch('with').fetch('path').lines.map(&:strip) == [
  '${{ runner.temp }}/enclosure.sig', '${{ runner.temp }}/release-receipt.json'
]
validation_index = steps.index { |step| step['name'] == 'Validate the appcast entry against the exact bytes users download' }
abort 'proof export must follow actual signature validation without always()' unless validation_index && steps.index(export_step) > validation_index && !export_step.key?('if')
puts 'macOS release proof: only public signature/receipt, after validation, under existing environment gate'

require 'tmpdir'
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
