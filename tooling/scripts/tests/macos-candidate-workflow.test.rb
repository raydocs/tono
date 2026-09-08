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
