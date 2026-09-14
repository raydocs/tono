import { expect, test } from '@playwright/test';
import { open, settle } from './ops';

test.describe('today page', () => {
  test('list', async ({ page }) => {
    await open(page, '/today');

    await expect(page.getByText('现在 2 个事故，影响 5 位客户')).toBeVisible();
    // Two open incidents, and exactly one primary action per row.
    await expect(page.locator('.incident-row')).toHaveCount(2);
    await expect(page.locator('.incident-row .ops-action-primary')).toHaveCount(2);

    // The primary is what moves the fault, by what broke; 认领 is beside it.
    const blocked = page.locator('.incident-row').first();
    await expect(blocked.getByRole('button', { name: '下架预览' })).toBeVisible();
    await expect(blocked.getByRole('button', { name: '认领' })).toBeVisible();
    await expect(page.locator('.incident-row').nth(1).getByRole('button', { name: '打开客户' }))
      .toBeVisible();
    await expect(page).toHaveScreenshot('list.png');
  });

  test('the resolved tab is a different list, not a filter on the same one', async ({ page }) => {
    await open(page, '/today');
    await page.getByRole('tab', { name: /最近恢复/ }).click();
    await settle(page);
    await expect(page.locator('.incident-row')).toHaveCount(5);
    // Nothing to act on: a recovered incident has no primary action.
    await expect(page.locator('.incident-row .ops-action-primary')).toHaveCount(0);
  });

  test('chores are counted apart from incidents and never coloured as one', async ({ page }) => {
    await open(page, '/today');
    await page.getByRole('tab', { name: /待办/ }).click();
    await settle(page);
    await expect(page.locator('.incident-row')).toHaveCount(0);
    await expect(page.locator('.ops-tag.tone-rem').first()).toBeVisible();
  });

  /**
   * The floor on the newest macOS release is 1.8.0, and five customers are
   * still on 1.7.9 — so the chore exists now that the release data does. It is
   * a chore and not an incident: nothing is broken and nobody gets cut off.
   */
  test('客户 below the supported floor become a 版本过旧 chore, not an incident', async ({ page }) => {
    await open(page, '/today');
    await page.getByRole('tab', { name: /待办/ }).click();
    await settle(page);

    const stale = page.locator('li').filter({ hasText: '版本过旧' });
    await expect(stale).toHaveCount(5);
    await expect(stale.first()).toContainText('还在跑 1.7.9');
    await expect(page.locator('.incident-row')).toHaveCount(0);
  });

  /**
   * 开通跟进 is the one chore about a person rather than a machine, so the row
   * carries the handle to reach them on and a way into whatever page they
   * have. The invited half comes from the funnel: nobody has a customer row to
   * find them by, so this list is the only place they appear.
   */
  test('待办里有开通跟进，一行就能复制到微信号', async ({ page }) => {
    await open(page, '/today');
    await page.getByRole('tab', { name: /待办/ }).click();
    await settle(page);

    const chores = page.locator('li').filter({ hasText: '开通跟进' });
    await expect(chores).toHaveCount(4);
    const invited = chores.filter({ hasText: 'shu.qing@example.com' });
    await expect(invited).toContainText('开通 6 天还没注册');
    await expect(invited).toContainText('wx_shu_qing');
    await expect(invited.getByRole('button', { name: '复制微信号', exact: true })).toBeEnabled();

    // The tab count is the list itself, onboarding rows included (R4).
    const all = await page.locator('li').filter({ has: page.locator('.ops-tag.tone-rem') }).count();
    await expect(page.getByRole('tab', { name: /待办/ })).toContainText(String(all));
  });

  test('开通跟进 那一行点下去就是这个人', async ({ page }) => {
    await open(page, '/today');
    await page.getByRole('tab', { name: /待办/ }).click();
    await settle(page);
    await page.locator('li').filter({ hasText: 'shu.qing@example.com' }).first()
      .getByText('开通 6 天还没注册').click();
    await expect(page).toHaveURL(/invite=shu\.qing%40example\.com/);
    await expect(page.getByRole('dialog')).toContainText('还没在客户端登录过');
  });

  test('drawer', async ({ page }) => {
    await open(page, '/today');
    await page.locator('.incident-row').first().click();

    await expect(page).toHaveURL(/incident=inc-node-la/);
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    // The handling card, in the order the operator works through it.
    const blocks = [
      '已知事实', '尚未确认的影响', '受影响客户', '推荐下一步',
      '复测', '下次检查', '处理记录', '时间线', '推送记录', '动作',
    ];
    for (const block of blocks) {
      await expect(drawer.getByRole('heading', { name: block })).toBeVisible();
    }
    await settle(page);
    await expect(page).toHaveScreenshot('drawer.png');
  });

  /** The evidence is a measurement said out loud, never the engine's own key names. */
  test('the drawer explains itself without printing what it is made of', async ({ page }) => {
    await open(page, '/today?incident=inc-node-la');
    const drawer = page.getByRole('dialog');
    await expect(drawer).toContainText('大陆扫描：疑似被墙');
    await expect(drawer).toContainText('联通回程丢包 10.4%');
    await expect(drawer).toContainText('30 分钟内 31 次失败');
    await expect(drawer).toContainText('负载 0.04，内存 12%');
    for (const leak of ['blockStatus', 'fails30m', 'LIKELY_BLOCKED', '{', '}']) {
      await expect(drawer, leak).not.toContainText(leak);
    }
  });

  test('a blocked node leads with the unlisting it is heading for', async ({ page }) => {
    await open(page, '/today');
    await page.locator('.incident-row').first()
      .getByRole('button', { name: '下架预览' }).click();
    await expect(page).toHaveURL(/#\/nodes\/.+/);
    await expect(page.getByRole('heading', { name: '这台机器' })).toBeVisible();
  });

  test('the drawer survives a reload, because it lives in the URL', async ({ page }) => {
    await open(page, '/today?incident=inc-node-la');
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  /**
   * The write path end to end: the POST lands, the console refetches, and the
   * row comes back saying what the server now believes rather than what the
   * click hoped for.
   */
  test('acknowledging an incident changes what the next read returns', async ({ page }, testInfo) => {
    await open(page, '/today', 'default', `ack-${testInfo.project.name}`);
    const row = page.locator('.incident-row').first();
    await expect(row.getByRole('button', { name: '认领' })).toBeVisible();
    await row.getByRole('button', { name: '认领' }).click();
    await settle(page);
    await expect(page.locator('.incident-row').first().getByRole('button', { name: '标记已处理' }))
      .toBeVisible();
    // Still open — an ack is a claim, not a fix.
    await expect(page.getByText('现在 2 个事故，影响 5 位客户')).toBeVisible();
  });

  test('a quiet fleet says when the last one recovered', async ({ page }) => {
    await open(page, '/today', 'empty');
    await expect(page.getByText(/^现在没有事故。上次事故 .+ 已恢复。$/)).toBeVisible();
    await expect(page.locator('.incident-row')).toHaveCount(0);
    await expect(page).toHaveScreenshot('quiet.png');
  });
});

/**
 * 处置卡: the three things the drawer has to be able to do before it deserves
 * the name — separate a repair from a mistake, say when to come back, and keep
 * the record of what was already tried.
 */
test.describe('事故处置卡', () => {
  test('误报收尾之后这一行写的是误报，恢复数不跟着涨', async ({ page }, testInfo) => {
    const session = `closure-${testInfo.project.name}-${String(Date.now())}`;
    await open(page, '/today', 'default', session);
    const recovered = page.getByRole('tab', { name: /最近恢复/ });
    await expect(recovered).toContainText('5');

    await open(page, '/today?incident=inc-user-jiangsu', 'default', session);
    await page.getByRole('dialog').getByRole('button', { name: '标记已处理' }).click();

    const ask = page.getByRole('dialog').filter({ hasText: '三种收尾' });
    await expect(ask).toBeVisible();
    // 已验证恢复 is refused while the newest measurement still reads as an
    // alarm, and the refusal says which reading it is refusing on.
    await expect(ask.locator('input[value="verified"]')).toBeDisabled();
    await ask.locator('input[value="false_positive"]').check();
    await ask.locator('input[type="text"]').fill('客户自己换了网络，不是节点的问题');
    await ask.getByRole('button', { name: '标记已处理' }).click();
    await settle(page);

    // A rule that fired wrongly is not a repair: the row says so, and the
    // count of recoveries is exactly where it was.
    await page.getByRole('dialog').getByRole('button', { name: '关闭' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await recovered.click();
    await settle(page);
    await expect(recovered).toContainText('5');
    await expect(page.locator('.incident-row').filter({ hasText: '误报' })).toHaveCount(1);
  });

  test('定下次检查之后抽屉里写着什么时候回来看', async ({ page }, testInfo) => {
    const session = `check-${testInfo.project.name}-${String(Date.now())}`;
    await open(page, '/today?incident=inc-node-la', 'default', session);
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText('还没定下次什么时候回来看')).toBeVisible();
    await drawer.getByRole('button', { name: '1 小时后' }).click();
    await settle(page);
    await expect(drawer.getByText(/^下次检查 /)).toBeVisible();
  });

  test('处理记录留得住上一个人做过的事', async ({ page }, testInfo) => {
    const session = `log-${testInfo.project.name}-${String(Date.now())}`;
    await open(page, '/today?incident=inc-node-la', 'default', session);
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText('已经从大陆重测过一轮，还是不通')).toBeVisible();

    await drawer.getByPlaceholder('写一句备注').fill('已经联系机房，等回复');
    await drawer.getByRole('button', { name: '记下' }).click();
    await settle(page);
    await expect(drawer.getByText('已经联系机房，等回复')).toBeVisible();
  });

  /**
   * The engine counts who it measured failing. The people on the same machine
   * whose clients have said nothing since are the ones the old page left out
   * of the story entirely.
   */
  test('尚未确认的影响把没测到的人也算进来', async ({ page }) => {
    await open(page, '/today?incident=inc-node-la');
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText(/位确认受影响，\d+ 位可能/)).toBeVisible();
  });
});

/**
 * 早报: the morning read. The review's demand is that a quiet night still
 * produces something you can act on — or, failing that, one honest sentence
 * rather than three empty headings.
 */
test.describe('早报', () => {
  test('昨夜有事就把恢复的和新开的分开说，每一行都点得动', async ({ page }) => {
    await open(page, '/today');
    const digest = page.locator('section').filter({ hasText: '早报' }).first();
    await expect(digest.getByText('昨夜')).toBeVisible();
    await expect(digest.getByText('2 个事故进行中')).toBeVisible();
    await expect(digest.getByText(/客户跟进 \d+ 条/)).toBeVisible();

    await digest.getByRole('button', { name: /Tokyo · Sakura/ }).click();
    await expect(page).toHaveURL(/incident=inc-r1/);
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  /**
   * The night the engine flapped: 劣化 opened ten times on one machine with
   * lives of about a minute, and the block printed all ten. It now says the
   * thing once, says that it is flapping, and stops at six lines a half — the
   * rest are counted, with the list they came from one click away.
   */
  test('反复开关的一夜归成一行，抖动自己也是一条线，超过六组只报数', async ({ page }) => {
    await open(page, '/today', 'dense');
    const digest = page.locator('section').filter({ hasText: '早报' }).first();

    const flap = digest.locator('.night-group').filter({ hasText: '反复开关' });
    await expect(flap).toHaveCount(1);
    await expect(flap).toContainText('Tokyo · Fuji 回程丢包，2 人在用 ×10');
    // Nine of the ten were repairs and one was a mistake, counted apart:
    // 已恢复 ×10 over a false alarm is the lie the closure word exists to stop.
    await expect(flap).toContainText('已恢复 ×9 · 误报 ×1');
    await expect(flap).toContainText('反复开关 10 次，最短 59 秒，判定可能在抖动');

    // Four groups recovered and six of the twenty-one still open: ten lines,
    // and the fifteen that did not fit are a number rather than a wall.
    await expect(digest.locator('.night-group')).toHaveCount(10);
    const more = digest.getByRole('button', { name: '还有 15 组' });
    await expect(more).toBeVisible();
    // One screen at 1440×900, on the worst night the fixtures have. #140's
    // dense 早报 landed at ~499px; keep the cap inside a laptop viewport.
    const box = await digest.boundingBox();
    expect(box!.height).toBeLessThan(520);
    await expect(page).toHaveScreenshot('digest-dense.png');

    await more.click();
    await expect(page.getByRole('tab', { name: /进行中/ })).toHaveAttribute('aria-selected', 'true');
  });

  /** What a flapping machine raises is a question about the machine, not about its tenth minute. */
  test('抖动那一行去的是机器的页面', async ({ page }) => {
    await open(page, '/today', 'dense');
    const digest = page.locator('section').filter({ hasText: '早报' }).first();
    await digest.getByRole('button', { name: /反复开关/ }).click();
    await expect(page).toHaveURL(/#\/nodes\/Tokyo/);
  });

  test('平安的一夜也有一句话，不是三个空标题', async ({ page }) => {
    await open(page, '/today', 'empty');
    await expect(page.getByText('昨夜无事，今天没有到期的事')).toBeVisible();
    await expect(page.getByText('昨夜', { exact: true })).toHaveCount(0);
  });
});

/**
 * 复测 is the half of a repair the console never had: the operator measures
 * the thing again, and the record says they did — so four hours later there is
 * a way to tell a fault that was re-checked from one nobody has touched.
 */
test('复测把测量和记录一起做掉', async ({ page }, testInfo) => {
  const session = `recheck-${testInfo.project.name}-${String(Date.now())}`;
  await open(page, '/today?incident=inc-node-la', 'default', session);
  const drawer = page.getByRole('dialog');
  await drawer.getByRole('button', { name: '复测一次' }).click();

  const ask = page.getByRole('dialog').filter({ hasText: '再下发一次测量' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: '就复测一次' }).click();
  await settle(page);

  await expect(drawer.getByText('已复测')).toBeVisible();
});
