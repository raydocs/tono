import {
  type Env,
  type Row,
} from '../../env';

export async function operationsCatalogRevisions(e: Env) {
  const [metadata, current] = await Promise.all([
    e.DB.prepare(
      `SELECT revision, content_sha256, published_at, server_count, logical_node_count, deployment_count
       FROM operations_catalog_revision_metadata ORDER BY revision DESC LIMIT 250`,
    ).all<Row>(),
    e.DB.prepare(
      'SELECT revision, content_sha256, updated_at FROM managed_exit_catalog WHERE singleton_id = 1',
    ).first<Row>(),
  ]);
  const revisions = metadata.results.map((row) => ({
    revision: Number(row.revision),
    sha256: Number(row.revision) === Number(current?.revision ?? 0)
      ? String(current!.content_sha256)
      : String(row.content_sha256),
    publishedAt: Number(row.revision) === Number(current?.revision ?? 0)
      ? Number(current!.updated_at)
      : Number(row.published_at),
    serverCount: Number(row.server_count),
    logicalNodeCount: Number(row.logical_node_count),
    deploymentCount: Number(row.deployment_count),
    current: Number(row.revision) === Number(current?.revision ?? 0),
  }));
  if (current && !revisions.some((row) => row.revision === Number(current.revision))) {
    revisions.unshift({
      revision: Number(current.revision),
      sha256: String(current.content_sha256),
      publishedAt: Number(current.updated_at),
      serverCount: 0,
      logicalNodeCount: 0,
      deploymentCount: 0,
      current: true,
    });
  }
  return revisions;
}
