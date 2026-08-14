# Windows release notes

One file per stable version, named `<version>.md`, matching the version passed to the
**Build signed Windows release** workflow. That workflow refuses to build without it.

The text here is not a changelog for the team. It is the body of the GitHub Release *and*
the `notes` field of `latest.json`, which the in-app update dialog renders to every user
before they accept an update. Write it the way the Mac notes in
`apps/macos/release-notes/` are written: plain language, one line per change, specific
about what was wrong and what a person will now see. No commit hashes, no file paths, no
internal names.

Operator steps do not belong here — the release run prints those in its own summary.
