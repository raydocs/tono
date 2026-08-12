# Tono 0.0.60

- China app-routing updates now reach this version without needing a new build. Previously any change to the routing list had to ship inside a release, and a version that had not been updated read a newer list as an empty one — so it quietly routed nothing through the direct path until the update arrived.
- A routing entry this version does not understand is now skipped on its own instead of discarding the whole list with it. Tono records which entries it skipped, so a partial list is visible rather than silent.
- Routing updates are signed, and Tono checks the signature before applying one. An update that fails the check is refused outright. Traffic for Tono's own services and for Claude can never be moved off the protected path by an update, whatever it claims.
