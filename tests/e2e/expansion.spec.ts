import { expect, test, type Page } from '@playwright/test';
import { createInitialData } from '../../src/domain/seed';
import { createSession, createSessionExercise, sessionStats } from '../../src/domain/training';
import { shiftDate } from '../../src/domain/analytics';
import { expectPersisted, storedWorkspace } from './helpers';
import type { AppData } from '../../src/domain/types';
import { mediaUrls } from '../../src/content/catalog';

async function nav(page: Page, name: string) { await page.getByRole('navigation',{name:page.viewportSize()!.width<=760?'移动端导航':'主导航',exact:true}).getByRole('button',{name,exact:true}).click(); }
async function ready(page: Page) { await page.goto('/'); await expect(page.getByRole('button',{name:'开始今天的训练',exact:true})).toBeEnabled(); }
function fixture(visual = false) {
  const data=createInitialData(); const dates=visual?Array.from({length:18},(_,i)=>shiftDate('2026-10-16',-i*4)):['2026-10-16','2026-10-14','2026-09-01'];
  data.sessions=dates.map((date,i)=>{
    const session=createSession(data.templates[0],data.exercises,Date.parse(`${date}T02:00:00Z`)); session.name=visual?['上肢力量','下肢与核心','全身基础'][i%3]:'全身基础';session.date=date;session.status='completed';session.finishedAt=`${date}T02:45:00.000Z`;session.updatedAt=session.finishedAt;session.note=i===0?'动作更稳定，下一次继续保持。':'';
    const weight=visual?Math.max(20,80-i*2):[80,60,50][i]; const reps=visual?8:i===0?5:10;
    session.exercises=[createSessionExercise(data.exercises.find(ex=>ex.id==='ex-squat')!,2,weight,reps),createSessionExercise(data.exercises.find(ex=>ex.id==='ex-pushup')!,1,0,12),createSessionExercise(data.exercises.find(ex=>ex.id==='ex-plank')!,1,0,0,45)];
    for(const ex of session.exercises)ex.sets[0].status='completed';session.exercises[0].sets[1]={...session.exercises[0].sets[1],status:'completed',type:'warmup',weightKg:200,reps:10};return session;
  });data.onboarded=true;data.revision=20;return data;
}
async function install(page: Page, data: AppData) {
  await page.clock.install({time:new Date('2026-10-16T06:00:00Z')});await ready(page);
  await page.evaluate(data=>new Promise<void>((resolve,reject)=>{const open=indexedDB.open('jianlibao',1);open.onsuccess=()=>{const db=open.result;const tx=db.transaction('workspace','readwrite');tx.objectStore('workspace').put(data,'main');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};open.onerror=()=>reject(open.error);}),data);
  await page.reload();await expect(page.getByRole('button',{name:'开始今天的训练',exact:true})).toBeEnabled();
}

test('图解动作库：完整目录、筛选、收藏、分步讲解与开练闭环',async({page},info)=>{
  await ready(page);await nav(page,'动作');await expect(page.locator('.library-filter-line strong')).toHaveText('302');
  await page.getByLabel('搜索动作',{exact:true}).fill('平板哑铃卧推');await expect(page.locator('.movement-card')).toHaveCount(1);
  await page.getByRole('button',{name:'收藏平板哑铃卧推',exact:true}).click();await expectPersisted(page,d=>!!d.settings.favoriteExerciseIds?.includes('catalog-dumbbell-bench-press'));
  await page.getByRole('button',{name:'查看平板哑铃卧推讲解',exact:true}).click();await expect(page.locator('.technique-steps li')).toHaveCount(3);
  await page.getByRole('button',{name:'查看第3幅图解',exact:true}).click();await expect(page.getByAltText('平板哑铃卧推第3幅动作图解')).toHaveJSProperty('naturalWidth',512);
  await expect(page.getByText('常见错误',{exact:true})).toBeVisible();await page.getByRole('button',{name:'从这个动作开练',exact:true}).click();await page.getByRole('button',{name:'确认开始训练',exact:true}).click();
  await page.getByLabel('平板哑铃卧推第1组总重量',{exact:true}).fill('35');await page.getByRole('button',{name:'动作说明 ↗',exact:true}).click();await page.getByRole('button',{name:'关闭弹窗',exact:true}).click();await expect(page.getByLabel('平板哑铃卧推第1组总重量',{exact:true})).toHaveValue('35');
  await page.getByRole('button',{name:'完成平板哑铃卧推第1组',exact:true}).click();await expectPersisted(page,d=>sessionStats(d.sessions[0]).volumeKg===350);
  await nav(page,'动作');await page.getByLabel('搜索动作',{exact:true}).fill('帕洛夫抗旋推');await page.getByRole('button',{name:'查看帕洛夫抗旋推讲解',exact:true}).click();
  for(const frame of [1,2,3]){await page.getByRole('button',{name:`查看第${frame}幅图解`,exact:true}).click();const art=page.getByAltText(`帕洛夫抗旋推第${frame}幅动作图解`);await expect(art).toHaveAttribute('src',new RegExp(`/diagram-${frame}\\.svg$`));await expect(art).toHaveJSProperty('naturalWidth',512);}
  await page.screenshot({path:info.outputPath('pallof-guide-1440.png')});
});

test('统计周期、热身排除、独立训练量与单动作1RM趋势可追溯',async({page})=>{
  await install(page,fixture());await nav(page,'进步');await page.getByRole('button',{name:'统计总览',exact:true}).click();
  await expect(page.locator('.analytics-metric').nth(0).locator('strong')).toHaveText('2场');await expect(page.locator('.analytics-metric').nth(1).locator('strong')).toHaveText('1,000kg·次');
  await expect(page.locator('.training-breakdown')).toContainText('24');await expect(page.locator('.training-breakdown')).toContainText('90');await expect(page.locator('.muscle-bars')).toContainText('大腿前侧');
  await expect(page.locator('.muscle-bars > div').filter({has:page.getByText('大腿前侧',{exact:true})})).toContainText('2 组 · 33%');
  await page.getByRole('button',{name:'全部',exact:true}).click();await expect(page.locator('.analytics-metric').nth(0).locator('strong')).toHaveText('3场');
  await page.getByRole('button',{name:'自定义',exact:true}).click();await page.getByLabel('开始日期',{exact:true}).fill('2026-10-01');await page.getByLabel('结束日期',{exact:true}).fill('2026-10-16');await expect(page.locator('.analytics-metric').nth(1).locator('strong')).toHaveText('1,000kg·次');
  await page.getByRole('button',{name:'动作追踪',exact:true}).click();await page.getByLabel('趋势动作',{exact:true}).selectOption('ex-squat');await page.getByRole('button',{name:'估算 1RM',exact:true}).click();await expect(page.locator('.chart-readout strong')).toHaveText('93.33 kg');
  await page.getByLabel('趋势动作',{exact:true}).selectOption('ex-pushup');await expect(page.locator('.chart-readout strong')).toHaveText('12 次');await expect(page.getByRole('button',{name:'估算 1RM',exact:true})).toHaveCount(0);
});

test('历史筛选、CSV、修正、存模板、删除确认和复练均保留正确数据',async({page})=>{
  await install(page,fixture());await nav(page,'进步');await page.getByLabel('搜索训练历史',{exact:true}).fill('稳定');await expect(page.locator('.session-card')).toHaveCount(1);
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'导出明细 CSV',exact:true}).click();const download=await downloadPromise;expect(download.suggestedFilename()).toContain('.csv');
  await page.locator('.session-card').click();await page.getByRole('button',{name:'修正记录',exact:true}).click();await page.getByLabel('修正杠铃深蹲第1组重量',{exact:true}).fill('90');await page.getByRole('button',{name:'保存修正',exact:true}).click();await expectPersisted(page,d=>d.sessions[0].exercises[0].sets[0].weightKg===90);
  await page.locator('.session-card').click();await page.getByRole('button',{name:'存为模板',exact:true}).click();await expectPersisted(page,d=>d.templates.length===4);await page.getByRole('button',{name:'删除',exact:true}).click();await page.getByRole('button',{name:'保留记录',exact:true}).click();expect((await storedWorkspace(page)).sessions).toHaveLength(3);
  await page.getByRole('button',{name:'删除',exact:true}).click();await page.getByRole('button',{name:'确认删除这场历史',exact:true}).click();await expectPersisted(page,d=>d.sessions.length===2);
  await page.getByLabel('搜索训练历史',{exact:true}).fill('');await page.locator('.session-card').first().click();await page.getByRole('button',{name:'再练一次',exact:true}).click();await page.getByRole('button',{name:'确认开始训练',exact:true}).click();
  await expectPersisted(page,d=>d.sessions.length===3&&d.sessions.at(-1)?.status==='active');const active=(await storedWorkspace(page)).sessions.at(-1)!;expect(sessionStats(active).volumeKg).toBe(0);expect(active.exercises.flatMap(ex=>ex.sets).every(s=>s.status==='pending')).toBe(true);
});

test('旧版12动作数据无损扩充，收藏和自定义动作刷新后保留',async({page})=>{
  const data=fixture();data.exercises=data.exercises.slice(0,12);data.exercises.push({id:'my-local-exercise',name:'我的器械动作',muscle:'背部',equipment:'器械',kind:'weight-reps',description:'私人提示'});data.exercises[0].description='旧版个人文本';data.settings.favoriteExerciseIds=['my-local-exercise'];const old=structuredClone(data.sessions);
  await install(page,data);await expectPersisted(page,d=>d.exercises.length===303);const expanded=await storedWorkspace(page);expect(expanded.sessions).toEqual(old);expect(expanded.exercises[0].description).toBe('旧版个人文本');expect(expanded.revision).toBe(21);
  await page.reload();expect((await storedWorkspace(page)).revision).toBe(21);await nav(page,'动作');await page.getByRole('button',{name:'收藏',exact:true}).click();await expect(page.getByRole('button',{name:'查看我的器械动作讲解',exact:true})).toBeVisible();
});

test('补记历史必须逐组确认，按填写日期和时长统计并保留原记录',async({page})=>{
  await install(page,fixture());await nav(page,'进步');await page.getByRole('button',{name:'补记训练',exact:true}).click();
  await page.getByLabel('训练日期',{exact:true}).fill('2026-10-10');await page.getByLabel('实际时长（分钟）',{exact:true}).fill('50');
  await page.getByLabel(/从模板填入动作/).selectOption('template-full');await expect(page.getByRole('button',{name:'保存补记训练',exact:true})).toBeDisabled();
  await page.getByLabel('杠铃深蹲第1组总重量',{exact:true}).fill('42.5');await page.getByLabel('杠铃深蹲第1组次数',{exact:true}).fill('8');await page.getByRole('button',{name:'完成杠铃深蹲第1组',exact:true}).click();
  await page.getByRole('button',{name:'保存补记训练',exact:true}).click();await expectPersisted(page,d=>d.sessions.length===4);
  const data=await storedWorkspace(page);const manual=data.sessions.find(s=>s.recordedManually)!;expect(manual.date).toBe('2026-10-10');expect(sessionStats(manual)).toMatchObject({volumeKg:340,completedSets:1,activeSeconds:3000});expect(data.sessions.filter(s=>!s.recordedManually)).toHaveLength(3);
  await page.getByRole('button',{name:'统计总览',exact:true}).click();await page.getByRole('button',{name:'近7天',exact:true}).click();await expect(page.locator('.analytics-metric').nth(0).locator('strong')).toHaveText('3场');await expect(page.locator('.analytics-metric').nth(1).locator('strong')).toHaveText('1,340kg·次');
});

test('自动准备完整三帧，断网刷新后全部906张图解可解码',async({page,context})=>{
  test.setTimeout(90000);await ready(page);await page.evaluate(async()=>{await navigator.serviceWorker.ready;});await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
  await nav(page,'动作');await page.locator('.offline-library summary').click();await expect(page.getByRole('button',{name:'全部图解已就绪',exact:true})).toBeVisible({timeout:60000});
  const cached=await page.evaluate(async()=>(await(await caches.open('jianlibao-media-aac59922')).keys()).length);expect(cached).toBe(906);
  await context.setOffline(true);await page.reload();await page.getByLabel('搜索动作',{exact:true}).fill('蝴蝶式拉伸');await page.getByRole('button',{name:'查看蝴蝶式拉伸讲解',exact:true}).click();await expect(page.getByAltText('蝴蝶式拉伸第1幅动作图解')).toHaveJSProperty('naturalWidth',512);await expect(page.locator('.technique-steps')).toContainText('呼吸');
  const failed=await page.evaluate(async urls=>{let next=0;const failed:string[]=[];await Promise.all(Array.from({length:8},async()=>{while(next<urls.length){const url=urls[next++];const image=new Image();try{image.src=url;await image.decode();if(image.naturalWidth!==512)failed.push(url);}catch{failed.push(url);}finally{image.src='';}}}));return failed;},mediaUrls);expect(failed).toEqual([]);
});

for(const width of [320,390,768,1440])test(`${width}px 历史、统计和图解库的实际操作与视觉检查`,async({page},info)=>{
  await page.setViewportSize({width,height:980});await install(page,fixture(true));
  const noOverflow=async()=>expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await nav(page,'进步');await noOverflow();await page.screenshot({path:info.outputPath(`history-${width}.png`),animations:'disabled'});
  if(width<=760){await expect(page.locator('.calendar-grid')).not.toBeVisible();await expect(page.locator('.session-card').first()).toBeInViewport({ratio:.7});await page.locator('.calendar-card summary').click();}
  await page.getByRole('button',{name:'2026-10-16，1场训练',exact:true}).click();await expect(page.locator('.session-card')).toHaveCount(1);if(width<=760)await expect(page.locator('.calendar-grid')).not.toBeVisible();
  await page.getByRole('button',{name:'统计总览',exact:true}).click();await noOverflow();await page.screenshot({path:info.outputPath(`statistics-${width}.png`),fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'动作追踪',exact:true}).click();await noOverflow();await page.screenshot({path:info.outputPath(`exercise-analysis-${width}.png`),animations:'disabled'});
  await nav(page,'动作');await noOverflow();await page.screenshot({path:info.outputPath(`library-${width}.png`),animations:'disabled'});await page.getByLabel('搜索动作',{exact:true}).fill('杠铃深蹲');await page.getByRole('button',{name:'查看杠铃深蹲讲解',exact:true}).click();await noOverflow();await page.screenshot({path:info.outputPath(`guide-${width}.png`),animations:'disabled'});
  await page.getByRole('button',{name:'关闭弹窗',exact:true}).click();await page.getByLabel('搜索动作',{exact:true}).fill('');await page.getByRole('button',{name:'切换主题',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','light');await noOverflow();await page.screenshot({path:info.outputPath(`library-light-${width}.png`),animations:'disabled'});
  await nav(page,'进步');await page.getByRole('button',{name:'统计总览',exact:true}).click();await noOverflow();await page.screenshot({path:info.outputPath(`statistics-light-${width}.png`),fullPage:true,animations:'disabled'});
});
