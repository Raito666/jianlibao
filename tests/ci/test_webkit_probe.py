"""Free-tier diagnostic workflow is separate from compatibility acceptance."""
from pathlib import Path
import json,unittest
ROOT=Path(__file__).resolve().parents[2]
class ProbeWorkflow(unittest.TestCase):
 def test_probe_is_manual_bounded_m2_without_ios_or_publishing(self):
  flows=json.loads((ROOT/'codemagic.yaml').read_text(encoding='utf-8'))['workflows'];self.assertIn('webkit-probe-free',flows);flow=flows['webkit-probe-free']
  self.assertEqual(flow['instance_type'],'mac_mini_m2');self.assertLessEqual(flow['max_build_duration'],15);self.assertEqual(flow['environment'],{'xcode':'26.0','node':'24.19.0'})
  for field in ['triggering','publishing','integrations','environment_groups']:self.assertNotIn(field,flow)
  commands='\n'.join(step['script'] for step in flow['scripts']);self.assertIn('--frozen-lockfile',commands);self.assertIn('webkit_macos.py preflight',commands);self.assertIn('webkit_native_probe.mjs',commands)
  for forbidden in ['ios:sync','cap sync','ios_simulator.py','fastlane','app_store_connect','simctl']:self.assertNotIn(forbidden,commands.lower())
  for step in flow['scripts']:self.assertTrue(step['script'].startswith('set -euo pipefail\n'))
  self.assertEqual(flow['artifacts'],['artifacts/webkit-probe/*.json','artifacts/webkit-probe/*.png','artifacts/webkit-probe/*.log','artifacts/webkit-macos/host-environment.json'])
if __name__=='__main__':unittest.main()
