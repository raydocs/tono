# Tono 0.0.59

- When protection restarts in a way that closes existing connections, Tono now records that it happened. Previously the only sign was requests timing out afterwards, which looks the same as a restarted service or a network change — and telling those apart took a full day of investigation for the fault fixed in 0.0.55.
- A diagnostic that reported more unresolved addresses than it had actually looked up now counts only what it attempted.
