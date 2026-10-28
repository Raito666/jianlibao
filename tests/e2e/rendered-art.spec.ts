import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const python=process.env.JLB_QA_PYTHON ?? 'C:/Users/PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const inspectPixels=`import io,json,sys\nfrom PIL import Image\nim=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert('RGB')\nb=json.loads(sys.argv[1]);im=im.crop((round(b['x']),round(b['y']),round(b['x']+b['width']),round(b['y']+b['height'])))\ndark=sum(1 for r,g,b in im.get_flattened_data() if max(r,g,b)<120)\nprint(json.dumps({'width':im.width,'height':im.height,'darkFraction':dark/(im.width*im.height)}))`;
test('图解在切换详情尺寸、主题和三帧后实际绘制，有可见线条',async({page},info)=>{
  test.setTimeout(60000);
  const out=info.outputPath('rendered-art');await mkdir(out,{recursive:true});
  await page.goto('/#/exercises');
  const rows=[];
  for(const theme of ['dark','light']){
    if(theme==='light')await page.getByRole('button',{name:'切换主题',exact:true}).click();
    await page.getByLabel('搜索动作',{exact:true}).fill('半跪姿帕洛夫推');
    await page.getByRole('button',{name:'查看半跪姿帕洛夫推讲解',exact:true}).click();
    for(const width of [390,1440]){
      await page.setViewportSize({width,height:980});
      for(const frame of [1,2,3]){
        await page.getByRole('tab',{name:'简洁讲解',exact:true}).click();
        await page.getByRole('button',{name:`查看第${frame}幅图解`,exact:true}).click();
        await page.getByRole('tab',{name:'详细讲解',exact:true}).click();
        const art=page.locator('.technique-art img');
        await expect(art).toHaveJSProperty('naturalWidth',512);
        await art.evaluate(async image=>{if(image instanceof HTMLImageElement)await image.decode();});
        const box=await art.boundingBox();expect(box).not.toBeNull();
        const png=await page.screenshot();await writeFile(`${out}/${theme}-${width}-${frame}.png`,png);
        const pixels=JSON.parse(execFileSync(python,['-c',inspectPixels,JSON.stringify(box)],{input:png,encoding:'utf8'}));
        rows.push({theme,width,frame,...pixels});
        expect(pixels.darkFraction,`${theme} ${width} frame ${frame} must have visible drawing`).toBeGreaterThan(.002);
      }
    }
    await page.getByRole('button',{name:'关闭弹窗',exact:true}).click();
  }
  await writeFile(`${out}/pixels.json`,JSON.stringify(rows,null,2));
});
