-- The per-user catalog filter only withheld names of *active catalog* home
-- exits. Disabling, retiring, deleting or renaming a home exit dropped its name
-- from that set while the operator-published YAML still carried its block, so
-- the private residential node was served to every account. Fail closed: a name
-- that has ever belonged to a catalog home exit stays restricted until an
-- operator removes it here on purpose. Only the currently bound, active home
-- exit is ever re-admitted (src/catalog.ts homeRoutingForUser).
CREATE TABLE home_exit_catalog_name_history (
  proxy_name TEXT PRIMARY KEY,
  recorded_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO home_exit_catalog_name_history(proxy_name, recorded_at)
SELECT proxy_name, unixepoch() FROM home_exits WHERE kind = 'catalog';

INSERT OR IGNORE INTO home_exit_catalog_name_history(proxy_name, recorded_at)
SELECT value, unixepoch()
FROM home_exit_catalog_names, json_each(home_exit_catalog_names.proxy_names_json)
WHERE singleton_id = 1;

DROP TRIGGER home_exit_catalog_names_insert;
DROP TRIGGER home_exit_catalog_names_update;
DROP TRIGGER home_exit_catalog_names_delete;

UPDATE home_exit_catalog_names
   SET proxy_names_json = COALESCE((
         SELECT json_group_array(proxy_name) FROM home_exit_catalog_name_history
       ), '[]'),
       updated_at = unixepoch()
 WHERE singleton_id = 1;

-- Trigger bodies avoid OR IGNORE: an outer UPSERT's conflict policy overrides
-- it (SQLite), which would abort the operator's home_exits write.
--
-- One statement per trigger, each on one line: remote D1 migration ingestion
-- cannot parse multiline trigger bodies (see 0015, 0021). The home_exits
-- triggers only record names; the published set is rebuilt by the triggers on
-- the history table, so it follows every recorded name and every deliberate
-- operator removal.
CREATE TRIGGER home_exit_catalog_names_insert AFTER INSERT ON home_exits WHEN NEW.kind = 'catalog' BEGIN INSERT INTO home_exit_catalog_name_history(proxy_name, recorded_at) SELECT NEW.proxy_name, unixepoch() WHERE NOT EXISTS (SELECT 1 FROM home_exit_catalog_name_history WHERE proxy_name = NEW.proxy_name); END;

CREATE TRIGGER home_exit_catalog_names_update_old AFTER UPDATE OF proxy_name, kind ON home_exits WHEN OLD.kind = 'catalog' BEGIN INSERT INTO home_exit_catalog_name_history(proxy_name, recorded_at) SELECT OLD.proxy_name, unixepoch() WHERE NOT EXISTS (SELECT 1 FROM home_exit_catalog_name_history WHERE proxy_name = OLD.proxy_name); END;

CREATE TRIGGER home_exit_catalog_names_update_new AFTER UPDATE OF proxy_name, kind ON home_exits WHEN NEW.kind = 'catalog' BEGIN INSERT INTO home_exit_catalog_name_history(proxy_name, recorded_at) SELECT NEW.proxy_name, unixepoch() WHERE NOT EXISTS (SELECT 1 FROM home_exit_catalog_name_history WHERE proxy_name = NEW.proxy_name); END;

CREATE TRIGGER home_exit_catalog_name_history_publish_insert AFTER INSERT ON home_exit_catalog_name_history BEGIN UPDATE home_exit_catalog_names SET proxy_names_json = COALESCE((SELECT json_group_array(proxy_name) FROM home_exit_catalog_name_history), '[]'), updated_at = unixepoch() WHERE singleton_id = 1; END;

CREATE TRIGGER home_exit_catalog_name_history_publish_delete AFTER DELETE ON home_exit_catalog_name_history BEGIN UPDATE home_exit_catalog_names SET proxy_names_json = COALESCE((SELECT json_group_array(proxy_name) FROM home_exit_catalog_name_history), '[]'), updated_at = unixepoch() WHERE singleton_id = 1; END;
