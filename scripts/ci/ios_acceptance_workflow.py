"""Portable budget and manual workflow; no account credentials or network mutations."""
import math
WORKFLOW='ios-startup-cloud-acceptance-free'
MAX_MINUTES=25
RESERVE_MINUTES=0.5

def eligible(gate):
    minutes=gate.get('remainingM2Minutes')
    return (type(minutes) in (int,float) and math.isfinite(minutes) and minutes>=MAX_MINUTES+RESERVE_MINUTES
            and all(gate.get(key) is True for key in ['personal','repositoryPrivate'])
            and all(gate.get(key) is False for key in ['billingEnabled','hasPaymentInfo','customPlan']))

def workflow():
    return {'workflows':{WORKFLOW:{'name':'健力宝 · 冷启动/重开/原生云同步真实验收',
            'instance_type':'mac_mini_m2','max_build_duration':MAX_MINUTES,
            'environment':{'xcode':'26.0','node':'24.19.0'},
            'scripts':[
                {'name':'Install locked dependencies','script':'set -euo pipefail\nnpx --yes pnpm@11.25.0 install --frozen-lockfile'},
                {'name':'Build current Web and sync iOS','script':'set -euo pipefail\nnpx --yes pnpm@11.25.0 ios:sync'},
                {'name':'Install isolated Web peer engine','script':'set -euo pipefail\nnpx --yes pnpm@11.25.0 exec playwright install webkit'},
                {'name':'Existing four modules plus real native cloud / persistence','script':'set -euo pipefail\npython3 -B scripts/ci/ios_cloud_acceptance.py'}],
            'artifacts':['artifacts/ios-cloud-ui/*.json','artifacts/ios-cloud-ui/*.log','artifacts/ios-cloud-ui/*.png','artifacts/ios-ui/captures.zip','artifacts/ios-ui/ui-result.json','artifacts/ios-simulator/*-readiness.json','artifacts/ios-simulator/*-bootstatus.log']}}}
