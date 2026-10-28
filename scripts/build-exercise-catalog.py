"""Build the complete pinned catalog; Chinese text is project-authored, artwork stays attributed."""
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
rows = json.loads((ROOT/'artifacts/expansion-2026-10-16/workout-manifest.json').read_text(encoding='utf-8'))
names = dict(line.strip().split('|', 1) for line in (ROOT/'src/content/exercise-names.txt').read_text(encoding='utf-8').splitlines() if line.strip())
assert len(rows) == len(names) == 302
legacy = {'squat':'ex-squat','bench-press':'ex-bench','barbell-row':'ex-row','seated-dumbbell-press':'ex-press','romanian-deadlift':'ex-rdl','lat-pulldown':'ex-lat','bicep-curl':'ex-curl','walking-lunge':'ex-lunge','push-up':'ex-pushup','pull-up':'ex-pullup','plank':'ex-plank','crunch':'ex-crunch'}
muscles = {'Chest':'胸部','Shoulders':'肩部','Rear Delts':'肩部','Back':'背部','Upper Back':'背部','Lats':'背部','Lower Back':'背部','Biceps':'手臂','Triceps':'手臂','Forearms':'手臂','Core':'核心','Glutes':'臀部','Quads':'腿部','Hamstrings':'腿部','Adductors':'腿部','Legs':'腿部','Calves':'小腿','Posterior Chain':'臀部','Mobility':'全身','Hips':'臀部'}
fine_muscles = {'Chest':'胸大肌','Shoulders':'三角肌','Rear Delts':'三角肌后束','Back':'背部肌群','Upper Back':'上背部','Lats':'背阔肌','Lower Back':'竖脊肌','Biceps':'肱二头肌','Triceps':'肱三头肌','Forearms':'前臂肌群','Core':'腹部核心','Glutes':'臀部肌群','Quads':'股四头肌','Hamstrings':'腘绳肌','Adductors':'内收肌群','Legs':'下肢肌群','Calves':'小腿肌群','Posterior Chain':'后侧链','Mobility':'活动度','Hips':'髋部肌群'}
fine_muscles.update({'Grip':'握持肌群','Groin':'腹股沟周围','Cardio':'心肺耐力'})
equipment = {'Bodyweight':'自重','Dumbbell':'哑铃','Machine':'器械','Barbell':'杠铃','Cable':'绳索','Resistance Band':'弹力带','Cardio':'有氧器械','Pull-up Bar':'单杠','Wall':'墙面','Towel':'毛巾','Plate':'杠铃片','Kettlebell':'壶铃','Doorway':'门框','Box':'台阶','Bench':'训练凳','Chair':'椅子','Stability Ball':'健身球'}
groups = {
'press':'0-5,61,76-77', 'fly':'6-7,74-75', 'pushup':'8-9,184-188,191-197',
'overhead':'10-12,78,81-83', 'raise':'13-15,19,84-86', 'rear':'16-17,87-88,204-205,208,253',
'facepull':'18,254', 'deadlift':'20,97,103-104,130', 'hinge':'21,49,107,117-120,136',
'row':'22-28,89-92,202-203,255', 'pulldown':'29-31,93,256', 'pullup':'32-35,94-96,212-215',
'shrug':'36,99', 'squat':'37-40,100-102,128-129,135,142,216-221,225-226,247',
'lunge':'41-43,108-109,125-127,131-134,222-224,227', 'legextension':'44',
'legcurl':'45-46,105-106,238-240', 'bridge':'47-48,112-116,230-231,241-243',
'calf':'50-51,140-141,228-229', 'curl':'52-56,144-149', 'wrist':'57,157',
'triceps':'58-60,150-154,156', 'dip':'62-63,79-80,155,201',
'plank':'64-65,68,260-261,267-269,273,275-276', 'legraise':'66,160,170-171,262-264,274,277',
'crunch':'67,159,162,172-173,265-266', 'cardio':'69-73,163,176-183',
'kickback':'110,121,232,248,250', 'abduction':'111,122,233-234,236-237,244-246,249,251-252',
'adduction':'123-124', 'swing':'137', 'extension':'98,138-139,206-207',
'jump':'143,281-285,287', 'carry':'158', 'twist':'161,167,174-175,258',
'deadbug':'164,259', 'birddog':'165', 'antirotation':'166,168-169,257',
'handstand':'189-190,198-200', 'hang':'209-211', 'mobility':'235,288-301',
'burpee':'270-272,278-280,286',
}
profiles={}
for family, indexes in groups.items():
    for part in indexes.split(','):
        span=part.split('-'); values=range(int(span[0]), int(span[-1])+1)
        for i in values:
            assert i not in profiles, i
            profiles[i]=family
# Leg press is mechanically distinct from a squat.
profiles[40]='legpress'
assert set(profiles)==set(range(302)), sorted(set(range(302))-set(profiles))
advanced = {83,106,137,143,189,190,191,192,193,198,199,200,214,215,217,219,221,235,273,276,277}
entries=[]
for i, r in enumerate(rows):
    slug=r['slug']
    entries.append({'id':legacy.get(slug,'catalog-'+slug),'slug':slug,'name':names[slug],'english':r['name'],'muscle':muscles[r['primaryMuscle']],'primary':fine_muscles[r['primaryMuscle']],'secondary':[fine_muscles[x] for x in r['secondaryMuscles']], 'equipment':equipment[r['equipment']], 'kind':'weight-reps' if r['exerciseType']=='weight_reps' else 'duration' if r['exerciseType'] in ['duration','distance_duration'] or r['isStretch'] else 'reps','profile':profiles[i],'level':'高阶' if i in advanced else '基础' if r['equipment'] in ['Machine','Cardio','Bodyweight','Resistance Band'] else '进阶','stretch':r['isStretch'],'artSource':r['attribution'].get('source',{}).get('url'),'number':i+1})
# Preserve the public IDs and recording conventions of the original 12 exercises.
for item in entries:
    if item['id'] in ['ex-rdl','ex-lunge']: item['muscle']='腿部'
    if item['id']=='ex-lat': item['equipment']='器械'
    if item['id']=='ex-curl': item['equipment']='哑铃'
content={'version':'aac59922','source':'https://github.com/bryllim/workout-guide','commit':'aac599224bb9780305239607ef98540b7e0ce389','entries':entries}
(ROOT/'src/content/catalog.json').write_text(json.dumps(content,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print('Built',len(entries),'Chinese illustrated entries; profiles',len(set(profiles.values())))
