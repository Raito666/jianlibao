import { expect, test, type Page } from '@playwright/test';
import { storedWorkspace } from './helpers';
async function library(page: Page) {
  await page.goto('/#/exercises');
  await expect(page.getByRole('heading',{name:'动作图书馆',exact:true})).toBeVisible();
}
async function open(page: Page, name='杠铃深蹲') {
  await page.getByLabel('搜索动作',{exact:true}).fill(name);
  await page.getByRole('button',{name:`查看${name}讲解`,exact:true}).click();
}
test('双层文字讲解可用键盘切换，阅读不修改训练数据',async({page})=>{
  await library(page);const before=await storedWorkspace(page);await open(page);
  await expect(page.getByRole('tab',{name:'简洁讲解',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.locator('.technique-steps li')).toHaveCount(3);await expect(page.getByRole('heading',{name:'如何记录',exact:true})).toHaveCount(0);
  await page.getByRole('tab',{name:'简洁讲解',exact:true}).focus();await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab',{name:'详细讲解',exact:true})).toBeFocused();await expect(page.getByRole('heading',{name:'如何记录',exact:true})).toBeVisible();
  await expect(page.getByRole('tabpanel')).toContainText('总外部负重');await expect(page.getByRole('tabpanel')).toContainText('主要：');
  await page.keyboard.press('End');await expect(page.getByText('还没有这个动作的训练记录',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'返回动作讲解',exact:true}).click();await expect(page.getByRole('tab',{name:'简洁讲解',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'查看详细讲解与记录方式',exact:true}).click();await expect(page.getByRole('tab',{name:'详细讲解',exact:true})).toHaveAttribute('aria-selected','true');
  await page.keyboard.press('Escape');expect(await storedWorkspace(page)).toEqual(before);
});

test.describe('未缓存图解缺失',()=>{
  test.use({serviceWorkers:'block'});
  test('图片失败仍能读两层文字并开始训练',async({page})=>{
    await page.route('**/exercise-art/**/frame-*.svg',route=>route.abort());await library(page);await open(page);
    await expect(page.getByText('这张图解暂不可用',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'播放分步图解',exact:true})).toBeDisabled();
    await page.getByRole('tab',{name:'详细讲解',exact:true}).click();await expect(page.locator('.technique-steps li')).toHaveCount(3);
    await page.getByRole('button',{name:'从这个动作开练',exact:true}).click();await page.getByRole('button',{name:'确认开始训练',exact:true}).click();await expect(page).toHaveURL(/#\/workout$/);
  });
});

for(const width of [320,390,768,1440])test(`${width}px 双层讲解、空表现和深浅主题排版`,async({page},info)=>{
  await page.setViewportSize({width,height:980});await library(page);
  const clean=async()=>expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  for(const theme of ['dark','light']){
    if(theme==='light'){await page.getByRole('button',{name:'切换主题',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','light');}
    await open(page,'半跪姿帕洛夫推');await expect(page.locator('.technique-art img')).toHaveJSProperty('naturalWidth',512);
    await clean();await page.screenshot({path:info.outputPath(`brief-${theme}-${width}.png`)});
    await page.getByRole('tab',{name:'详细讲解',exact:true}).click();await clean();await expect(page.locator('.guide-grid')).toBeVisible();
    await expect(page.locator('.technique-art img')).toHaveJSProperty('naturalWidth',512);
    await page.locator('.technique-art img').evaluate(async image=>{if(image instanceof HTMLImageElement)await image.decode();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
    await page.screenshot({path:info.outputPath(`detailed-${theme}-${width}.png`)});
    await page.getByRole('tab',{name:'我的表现',exact:true}).click();await clean();await expect(page.getByRole('heading',{name:'还没有这个动作的训练记录',exact:true})).toBeVisible();
    await page.keyboard.press('Escape');await page.getByLabel('搜索动作',{exact:true}).fill('');
  }
});
