/**
 * 备用通道自动切换: the account card and the one global switch in 设置.
 *
 * The client only ever switches to the backup channel of the node it is
 * already on; nothing here adds or removes a node, and choosing the backup
 * channel by hand keeps working either way. Every sentence says that, because
 * "auto-switch" read on its own sounds like moving customers between nodes.
 */
export const hy2SwitchCopy = {
  hy2Section: '备用通道自动切换',
  hy2Facts: {
    internal: '内部账户',
    setting: '本账户设置',
    effective: '现在',
  } as const,
  hy2Yes: '是',
  hy2No: '否',
  hy2On: '开',
  hy2Off: '关',
  hy2Override: {
    default: '跟随默认',
    on: '本账户开',
    off: '本账户关',
  } as const,
  hy2Lead: '主通道连不上时，客户端自己换到同一台节点的备用通道。只换通道，不换节点；手选备用通道不受影响，收不到备用通道的客户端也不会切。默认只对内部账户开。',
  hy2MarkInternal: '标为内部账户',
  hy2UnmarkInternal: '取消内部账户',
  hy2SetDefault: '跟随默认',
  hy2SetOn: '本账户开',
  hy2SetOff: '本账户关',
  hy2InternalTitle: (on: boolean) => (on ? '标为内部账户' : '取消内部账户'),
  hy2InternalBody: (email: string, on: boolean) => (on
    ? `${email} 算作内部账户：没有单独设置时，备用通道自动切换对它打开。只影响这一个账户，客户端下次取目录生效。`
    : `${email} 不再算内部账户：没有单独设置时，跟随全体开关。只影响这一个账户，客户端下次取目录生效。`),
  hy2OverrideTitle: '改本账户设置',
  hy2OverrideBody: (email: string, word: string) =>
    `${email} 改为「${word}」。只影响这一个账户，客户端下次取目录生效。`,

  hy2GlobalSection: '备用通道自动切换（全体账户）',
  hy2GlobalFacts: {
    state: '全体开关',
    internal: '内部账户',
    pinnedOn: '单独开',
    pinnedOff: '单独关',
  } as const,
  hy2AccountsUnit: (n: number) => `${n} 个`,
  hy2GlobalOn: '对全体账户打开',
  hy2GlobalOff: '对全体账户关闭',
  hy2GlobalOnTitle: '对全体账户打开自动切换',
  hy2GlobalOnBody: (pinnedOff: number) =>
    `所有账户的客户端在主通道连不上时，会自己换到同一台节点的备用通道。单独设为「本账户关」的 ${pinnedOff} 个账户仍然关着。客户端下次取目录生效。`,
  hy2GlobalOffTitle: '对全体账户关闭自动切换',
  hy2GlobalOffBody: (internal: number, pinnedOn: number) =>
    `回到默认：只有内部账户（${internal} 个）和单独设为「本账户开」的账户（${pinnedOn} 个）还开着。客户端下次取目录生效。`,
} as const;
