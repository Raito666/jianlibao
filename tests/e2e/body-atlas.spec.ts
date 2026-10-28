import { expect, test, type Page, type Locator } from '@playwright/test';
import { muscleGroups, jointGroups } from '../../src/content/body-map';
import { expectPersisted, storedWorkspace } from './helpers';

async function library(page:Page) { await page.goto('/#/exercises'); await expect(page.locator('.library-filter-line strong')).toHaveText('302'); if(!await page.locator('.body-atlas').isVisible()) await page.getByRole('button',{name:/按身体部位筛选/}).click(); }
async function clickShape(shape:Locator) {
  const position=await shape.evaluate(el=>{
    if(!(el instanceof SVGGeometryElement))throw Error('Expected SVG navigation geometry');
    const box=el.getBoundingClientRect(),matrix=el.getScreenCTM();if(!matrix)throw Error('Missing SVG transform');
    for(const fraction of [.5,.65,.35,.8,.2])for(const vertical of [.5,.65,.35,.8,.2]){
      const point=new DOMPoint(box.x+box.width*fraction,box.y+box.height*vertical);
      if(el.isPointInFill(point.matrixTransform(matrix.inverse())))return {x:box.width*fraction,y:box.height*vertical};
    }
    throw Error('No filled point in navigation region');
  });
  await shape.click({position});
}
test('每个肌群与关节热点均可点选，浏览不会写入训练数据',async({page})=>{
  await library(page); const before=await storedWorkspace(page);
  for(const group of muscleGroups) {
    const side=group.side==='back'?'背面':'正面';
    if(await page.getByRole('button',{name:side,exact:true}).isVisible())await page.getByRole('button',{name:side,exact:true}).click();
    const region=page.locator(`.atlas-figures [data-region="${group.id}"]`).filter({visible:true}).first();
    await clickShape(region.locator('path').first());
    await expect(region).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('.atlas-selection-copy h4')).toHaveText(group.label);
    expect(Number(await page.locator('.library-filter-line strong').innerText()),group.label).toBeGreaterThan(0);
  }
  await page.getByRole('button',{name:'关节',exact:true}).click();
  for(const group of jointGroups){
    const region=page.locator(`.atlas-figures [data-region="${group.id}"]`).filter({visible:true}).first();
    await region.locator('circle').first().click();
    await expect(region).toHaveAttribute('aria-pressed','true');
    expect(Number(await page.locator('.library-filter-line strong').innerText())).toBeGreaterThan(0);
  }
  expect((await storedWorkspace(page)).revision).toBe(before.revision);
  expect((await storedWorkspace(page)).sessions).toEqual(before.sessions);
});

test('身体选区、器械与难度交集、速查、详解和训练记录闭环',async({page})=>{
  await library(page);
  const chest=page.getByRole('button',{name:'选择胸部',exact:true});
  await chest.focus(); await page.keyboard.press('Enter');
  await expect(chest).toHaveAttribute('aria-pressed','true');
  await page.getByLabel('器械筛选',{exact:true}).selectOption('哑铃');
  await page.getByLabel('难度筛选',{exact:true}).selectOption('进阶');
  const count=Number(await page.locator('.library-filter-line strong').innerText()); expect(count).toBeGreaterThan(0);
  const use=page.getByRole('button',{name:`查看${count}个部位相关动作`,exact:true});
  await use.click(); await expect(page.locator('.library-filter-line')).toBeFocused();
  const card=page.locator('.movement-card').filter({has:page.getByRole('heading',{name:'平板哑铃卧推',exact:true})});
  await card.locator('summary').click(); await expect(card.locator('.movement-quick li')).toHaveCount(3);
  await card.getByRole('button',{name:'查看完整讲解',exact:true}).click();
  await expect(page.getByRole('tab',{name:'简洁讲解',exact:true})).toHaveAttribute('aria-selected','true');
  await page.getByRole('tab',{name:'详细讲解',exact:true}).click();
  await expect(page.getByRole('region',{name:'动作参与肌群',exact:true})).toBeVisible();
  expect(await page.locator('.muscle-reference .primary').count()).toBeGreaterThan(0);
  await expect(page.getByRole('heading',{name:'发力与呼吸',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'关闭弹窗',exact:true}).click();
  await expect(page.locator('.selected-body-label')).toContainText('胸部');
  await card.getByRole('button',{name:'查看平板哑铃卧推讲解',exact:true}).click();
  await page.getByRole('button',{name:'从这个动作开练',exact:true}).click();
  await page.getByRole('button',{name:'确认开始训练',exact:true}).click();
  await page.getByLabel('平板哑铃卧推第1组总重量',{exact:true}).fill('30');
  await page.getByRole('button',{name:'完成平板哑铃卧推第1组',exact:true}).click();
  await expectPersisted(page,data=>data.sessions.some(s=>s.exercises.some(ex=>ex.exercise.name==='平板哑铃卧推' && ex.sets[0].weightKg===30 && ex.sets[0].status==='completed')));
});

test('协同筛选可扩展结果，切换外形与朝向保留选择，筛选空结果可恢复',async({page})=>{
  await library(page);await page.getByRole('button',{name:'选择肱三头肌',exact:true}).locator('path').first().click();
  const primary=Number(await page.locator('.library-filter-line strong').innerText());
  await page.getByLabel('包含协同参与的动作',{exact:true}).check();
  expect(Number(await page.locator('.library-filter-line strong').innerText())).toBeGreaterThan(primary);
  await page.getByRole('button',{name:'女性',exact:true}).click();
  await expect(page.locator('.atlas-figures .body-figure.feminine')).toHaveCount(2);
  await expect(page.locator('.atlas-selection-copy h4')).toHaveText('肱三头肌');
  await page.getByLabel('搜索动作',{exact:true}).fill('没有这种动作12345');
  await expect(page.locator('.library-filter-line strong')).toHaveText('0');
  await page.getByRole('button',{name:'清空筛选',exact:true}).click();
  await expect(page.locator('.library-filter-line strong')).toHaveText('302');
});

for(const width of [320,390,768,1440])test(`身体导航 ${width}px 深浅主题与离线流程`,async({page,context},info)=>{
  await page.setViewportSize({width,height:980});await library(page);
  const chest=page.getByRole('button',{name:'选择胸部',exact:true});
  await chest.focus();await page.keyboard.press('Space');await expect(chest).toHaveAttribute('aria-pressed','true');
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  for(const theme of ['dark','light']){
    if(theme==='light')await page.getByRole('button',{name:'切换主题',exact:true}).click();
    await page.evaluate(()=>window.scrollTo(0,0));
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width} ${theme}`).toBe(true);
    for(const art of await page.locator('.movement-art img').all()){await art.scrollIntoViewIfNeeded();await expect(art).toHaveJSProperty('naturalWidth',512);}
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:info.outputPath(`atlas-${width}-${theme}.png`),fullPage:true});
    await page.screenshot({path:info.outputPath(`atlas-${width}-${theme}-viewport.png`)});
  }
  await page.getByRole('button',{name:'背面',exact:true}).isVisible().then(async visible=>{if(visible)await page.getByRole('button',{name:'背面',exact:true}).click();});
  if(width<=760){await expect(page.getByRole('button',{name:'选择肱三头肌',exact:true})).toBeVisible();await page.locator('.atlas-region-picker summary').click();await page.getByRole('group',{name:'身体部位名称',exact:true}).getByRole('button',{name:/大腿后侧/}).click();await expect(page.locator('.atlas-selection-copy h4')).toHaveText('大腿后侧');}
  await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();
  await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);await page.reload();
  if(!await page.locator('.body-atlas').isVisible())await page.getByRole('button',{name:/按身体部位筛选/}).click();
  await page.getByRole('button',{name:'选择胸部',exact:true}).focus();await page.keyboard.press('Enter');
  await page.getByLabel('搜索动作',{exact:true}).fill('杠铃卧推');
  await page.getByRole('button',{name:'查看杠铃卧推讲解',exact:true}).click();
  await page.getByRole('tab',{name:'详细讲解',exact:true}).click();
  await expect(page.locator('.muscle-reference')).toBeVisible();
  expect(errors).toEqual([]);
});
