import { expect, it } from 'vitest';
import { clusterCode, clusterNode, clusterStage, clusterStatus } from './diagnostics';

it('says a known cluster code, stage and status in Chinese and leaves an unknown one raw', () => {
  expect(clusterCode('TONO_NODE_OR_CORE_UNREACHABLE')).toBe('当前节点和核心都没通过验证');
  expect(clusterCode('TONO_FAIL_OPEN')).toBe('保护失效，流量被放开了');
  expect(clusterCode('TONO_SERVICE_NOT_RUNNING')).toBe('客户端的后台服务没在跑');
  expect(clusterCode('TONO_BFE_NOT_RUNNING')).toBe('Windows 的网络过滤服务没开');
  expect(clusterCode('TONO_FROM_THE_FUTURE')).toBe('TONO_FROM_THE_FUTURE');
  expect(clusterCode('toString')).toBe('toString');
  expect(clusterStage('verifyingTraffic')).toBe('验证流量');
  expect(clusterStage('protection')).toBe('掉线保护');
  // Stages are nouns, not progressive verbs.
  expect(clusterStage('connect')).toBe('连接');
  expect(clusterStage('connected')).toBe('连接后');
  expect(clusterStage('securingDNS')).toBe('DNS 保护');
  expect(clusterStage('somethingNew')).toBe('somethingNew');
  expect(clusterStatus('open')).toBe('进行中');
  expect(clusterStatus('quiet')).toBe('已安静');
  expect(clusterStatus('paused')).toBe('paused');
  expect(clusterNode('unselected')).toBe('没选节点');
  expect(clusterNode(null)).toBe('没选节点');
  expect(clusterNode('Los Angeles · Marina')).toBe('Los Angeles · Marina');
});
