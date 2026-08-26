import type { CarrierPingMapDto } from './api';
import { carrierRows, latencyTone, lossTone, type CarrierRow, type Tone } from './lib/carrier';

/**
 * Three carriers, two metrics, one hour — laid out as small multiples.
 *
 * The shape is borrowed from the Glassmorphism three-network Komari theme,
 * which puts the number and its recent history on the same line so a 240 ms
 * reading can be told apart from a 240 ms spike. The route chips this console
 * already showed name the path (9929, CMIN2); this is the half that measures
 * it.
 *
 * It sits in the expanded row rather than the table. Sixteen nodes times three
 * carriers times two metrics times twelve buckets is over a thousand cells, and
 * the question the table answers — which node is blocked — would drown in it.
 */
function Bars({ row, metric }: { row: CarrierRow; metric: 'latency' | 'loss' }) {
  if (!row.history.length) {
    return <div className="carrier-bars carrier-bars-empty" title={row.detail} />;
  }
  return (
    <div className="carrier-bars" title={row.detail}>
      {row.history.map((point, index) => {
        const tone: Tone = metric === 'latency'
          ? latencyTone(point.latencyMs)
          : lossTone(point.lossPct);
        return <span key={index} className={`carrier-bar carrier-${tone}`} />;
      })}
    </div>
  );
}

function Panel({ title, rows, metric }: {
  title: string;
  rows: CarrierRow[];
  metric: 'latency' | 'loss';
}) {
  return (
    <div className="carrier-panel">
      <div className="carrier-panel-head"><span>{title}</span><span className="muted">三网</span></div>
      {rows.map((row) => (
        <div className="carrier-row" key={`${metric}-${row.key}`}>
          <div className="carrier-name">
            <span className={`carrier-dot carrier-dot-${row.key}`} aria-hidden />
            <span>{row.label}</span>
            <span className={`carrier-value mono carrier-${metric === 'latency' ? row.latencyTone : row.lossTone}-text`}>
              {metric === 'latency' ? row.latencyText : row.lossText}
            </span>
          </div>
          <Bars row={row} metric={metric} />
        </div>
      ))}
    </div>
  );
}

export function CarrierMini({ carriers }: { carriers: CarrierPingMapDto }) {
  const rows = carrierRows(carriers);
  const probed = rows.filter((row) => row.probed);
  if (probed.length === 0) {
    return <p className="muted nc-carrier-mini">三网没测</p>;
  }
  return (
    <div className="nc-carrier-mini">
      {rows.map((row) => (
        <div className="nc-carrier-mini-row" key={row.key} title={row.detail}>
          <span className={`carrier-dot carrier-dot-${row.key}`} />
          <span>{row.label}</span>
          <span className={`mono carrier-${row.latencyTone}-text`}>{row.probed ? row.latencyText : '没测'}</span>
          {row.probed && row.history.length > 0 ? <Bars row={row} metric="latency" /> : <span className="carrier-bars carrier-bars-empty" />}
        </div>
      ))}
    </div>
  );
}

export function CarrierPing({ carriers }: { carriers: CarrierPingMapDto }) {
  const rows = carrierRows(carriers);
  const probed = rows.filter((row) => row.probed);
  return (
    <div className="carrier-card">
      {probed.length === 0 ? (
        // Same rule as the exposure panel next to it: an empty measurement is
        // not a good one.
        <p className="muted">
          还没测过三网延迟。空着不代表通，只是没测。
        </p>
      ) : (
        <>
          <div className="carrier-panels">
            <Panel title="延迟" rows={rows} metric="latency" />
            <Panel title="丢包" rows={rows} metric="loss" />
          </div>
          {probed.length < rows.length && (
            <p className="muted carrier-note">
              {rows.filter((row) => !row.probed).map((row) => row.label).join('、')}还没有数据，不是 0。
            </p>
          )}
        </>
      )}
      <p className="muted carrier-note">
        这是从节点打回大陆的延迟。大陆能不能连进来，看上面的状态，两回事。
      </p>
    </div>
  );
}
