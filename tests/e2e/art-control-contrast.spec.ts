import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";

const python = process.env.JLB_QA_PYTHON ??
  "C:/Users/PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe";

// A DOM style check cannot detect WebKit painting a native dark background
// over this illustration's light surface. Inspect the rendered control too.
const inspect = `import io,sys,json,re
from PIL import Image
from collections import Counter
im=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert('RGB')
assert im.width > 8 and im.height > 8
im=im.crop((4,4,im.width-4,im.height-4))
bg,count=Counter(im.get_flattened_data()).most_common(1)[0]
match=re.fullmatch(r'(rgb|rgba)[(]([0-9., ]+)[)]',sys.argv[1])
assert match, 'Unsupported foreground color serialization: '+sys.argv[1]
channels=[float(v.strip()) for v in match.group(2).split(',')]
assert len(channels)==(4 if match.group(1)=='rgba' else 3)
assert len(channels)==3 or channels[3]==1
fg=channels[:3]
def lum(rgb):
 c=[v/255 for v in rgb]
 c=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in c]
 return sum(v*w for v,w in zip(c,[.2126,.7152,.0722]))
a,b=sorted([lum(bg),lum(fg)])
print(json.dumps({'background':bg,'foreground':fg,'dominantFraction':count/(im.width*im.height),'contrast':(b+.05)/(a+.05)}))`;

function rgb(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === 3 &&
    value.every((channel: unknown) => typeof channel === "number" &&
      Number.isFinite(channel) && channel >= 0 && channel <= 255);
}

function measurement(raw: string) {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null ||
      !("background" in value) || !rgb(value.background) ||
      !("foreground" in value) || !rgb(value.foreground) ||
      !("dominantFraction" in value) || typeof value.dominantFraction !== "number" ||
      !Number.isFinite(value.dominantFraction) ||
      value.dominantFraction <= 0 || value.dominantFraction > 1 ||
      !("contrast" in value) || typeof value.contrast !== "number" ||
      !Number.isFinite(value.contrast) || value.contrast < 1 || value.contrast > 21) {
    throw new Error(`Invalid native-control pixel measurement: ${raw}`);
  }
  return value;
}

for (const width of [320, 390, 768, 1440]) {
  for (const theme of ["dark", "light"]) {
    test(`图解原生速度控件实际绘制对比度 ${width} ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/#/settings");
      await page.getByLabel("界面主题", { exact: true }).selectOption(theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.goto("/#/exercises");
      await page.getByLabel("搜索动作", { exact: true }).fill("死虫式");
      await page.getByRole("button", { name: "查看死虫式讲解", exact: true }).click();
      await expect(page.getByAltText("死虫式第1幅动作图解", { exact: true }))
        .toHaveJSProperty("naturalWidth", 512);
      const speed = page.getByLabel("图解播放速度", { exact: true });
      await speed.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.waitForFunction(() => document.getAnimations()
        .every((animation) => animation.playState !== "running" && !animation.pending));
      const target = await speed.boundingBox();
      expect(target).not.toBeNull();
      expect(target!.width).toBeGreaterThanOrEqual(44);
      expect(target!.height).toBeGreaterThanOrEqual(44);
      await speed.focus();
      await expect(speed).toBeFocused();
      const color = await speed.evaluate((element) => getComputedStyle(element).color);
      const png = await speed.screenshot({ path: info.outputPath("speed-select.png") });
      const raw = execFileSync(python, ["-c", inspect, color], {
        input: png, encoding: "utf8",
      });
      const result = measurement(raw);
      await info.attach("native-control-measurement", { body: raw, contentType: "application/json" });
      expect(result.dominantFraction).toBeGreaterThan(0.25);
      expect(result.contrast, `Visible native control: ${raw}`).toBeGreaterThanOrEqual(4.5);
      await speed.selectOption("1.5");
      await expect(speed).toHaveValue("1.5");
      await speed.selectOption("0.5");
      await expect(speed).toHaveValue("0.5");
    });
  }
}
