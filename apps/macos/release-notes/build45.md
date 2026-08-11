# Tono 0.0.43

- Repairing a rejected network helper is now a labelled action instead of a Terminal command: the dashboard offers **Repair and reconnect**, and the recovery command lives on the new Support page.
- New **Support & Diagnostics** page: system summary, log locations, the exact redacted report support receives, and the last-resort recovery command.
- The dashboard now shows a live throughput sparkline next to the upload and download readouts.
- Crashes are recorded locally and surfaced on the next launch instead of vanishing silently.
- Chinese localisation is complete for every shipped string; error messages no longer fall back to Chinese in English builds.
- Fixed a dead end where a freshly repaired network helper needed longer than the app's wait budget to start, leaving a "the authenticated helper did not start" error even though the repair had succeeded.
- Assistant traffic no longer dies mid-response when the residential hop stalls: the Claude route is now a health-checked fallback that prefers the residential identity and falls back to the protected exit.
- ChatGPT, Codex, Sora and Grok now use the same residential route as Claude.
