import { expect, test, type Page } from '@playwright/test';
import { MEDIA_CACHE, mediaUrls } from '../../src/content/catalog';
async function ready(page: Page) { await page.goto('/');await expect(page.getByRole('button',{name:'开始今天的训练',exact:true})).toBeEnabled(); }
async function open(page: Page) { await page.goto('/#/exercises');await page.getByLabel('搜索动作',{exact:true}).fill('死虫式');await page.getByRole('button',{name:'查看死虫式讲解',exact:true}).click(); }
test('旧缓存误存HTML后，自动从本机资源修复图解',async({page})=>{
  await ready(page);await page.evaluate(async()=>{await navigator.serviceWorker.ready;});await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
  await page.evaluate(async cache=>{await(await caches.open(cache)).put('/exercise-art/aac59922/dead-bug/frame-1.svg',new Response('<!doctype html><html><body>old fallback page</body></html>',{headers:{'Content-Type':'text/html'}}));},MEDIA_CACHE);
  expect(await page.evaluate(()=>new Promise<number>(resolve=>{const image=new Image();image.onload=()=>resolve(image.naturalWidth);image.onerror=()=>resolve(0);image.src='/exercise-art/aac59922/dead-bug/frame-1.svg';}))).toBe(512);
  await open(page);await expect(page.getByAltText('死虫式第1幅动作图解')).toHaveJSProperty('naturalWidth',512,{timeout:3000});
  const contentType=await page.evaluate(async cache=>{const response=await(await caches.open(cache)).match('/exercise-art/aac59922/dead-bug/frame-1.svg');return response?.headers.get('content-type');},MEDIA_CACHE);expect(contentType).toContain('image/svg+xml');
});
test.describe('图解请求恢复',()=>{
 test.use({serviceWorkers:'block'});
 test('临时加载失败后可就地重试，不用关闭讲解',async({page})=>{
  let failing=true;await page.route('**/dead-bug/frame-1.svg*',route=>failing?route.abort():route.continue());await open(page);
  await expect(page.getByText('这张图解暂不可用',{exact:true})).toBeVisible();failing=false;
  await page.getByRole('button',{name:'重新加载图解',exact:true}).click();await expect(page.getByAltText('死虫式第1幅动作图解')).toHaveJSProperty('naturalWidth',512);
 });
 test('自动离线准备可暂停并继续，不把部分下载算作全部就绪',async({page})=>{
  test.setTimeout(60000);let slow=true;await page.route('**/exercise-art/**',async route=>{if(slow)await new Promise(resolve=>setTimeout(resolve,250));await route.continue().catch(()=>{});});
  await page.goto('/#/exercises');await page.locator('.offline-library summary').click();await page.getByRole('button',{name:'暂停下载',exact:true}).click();await expect(page.getByRole('button',{name:'保存全部图解供离线使用',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'全部图解已就绪',exact:true})).toHaveCount(0);slow=false;await page.getByRole('button',{name:'保存全部图解供离线使用',exact:true}).click();await expect(page.getByRole('button',{name:'全部图解已就绪',exact:true})).toBeVisible({timeout:45000});
 });
 test('HTTP200的网页回退不能冒充图解完成离线包',async({page})=>{
  await page.route('**/dead-bug/frame-1.svg*',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><body>fallback</body></html>'}));await page.goto('/#/exercises');await page.locator('.offline-library summary').click();
  await expect(page.getByRole('alert')).toContainText('图解内容未能通过校验',{timeout:15000});await expect(page.getByRole('button',{name:'全部图解已就绪',exact:true})).toHaveCount(0);
  expect(await page.evaluate(async cache=>!!await(await caches.open(cache)).match('/exercise-art/aac59922/dead-bug/frame-1.svg'),MEDIA_CACHE)).toBe(false);
 });
});
test('离线包检查识别坏响应并允许修复，修复后断网可看',async({page,context})=>{
 test.setTimeout(90000);await ready(page);await page.evaluate(async()=>{await navigator.serviceWorker.ready;});await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
 await page.goto('/#/exercises');await page.locator('.offline-library summary').click();await expect(page.getByRole('button',{name:'全部图解已就绪',exact:true})).toBeVisible({timeout:60000});
 await page.evaluate(async cache=>{await(await caches.open(cache)).put('/exercise-art/aac59922/dead-bug/frame-1.svg',new Response('<svg xmlns="http://www.w3.org/2000/svg">',{headers:{'Content-Type':'image/svg+xml'}}));},MEDIA_CACHE);
 await page.reload();await page.locator('.offline-library summary').click();await expect(page.getByRole('button',{name:'全部图解已就绪',exact:true})).toBeVisible({timeout:60000});
 await context.setOffline(true);await open(page);await expect(page.getByAltText('死虫式第1幅动作图解')).toHaveJSProperty('naturalWidth',512);expect(mediaUrls).toHaveLength(906);
});
