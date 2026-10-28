"""Portable contracts for a UI-only runner that cannot reinstall the tested app."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]


class UIProjectContracts(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("ui_project", ROOT / "scripts/ci/ios_ui_project.py")
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def test_target_is_only_a_ui_test_bundle_without_app_dependencies(self):
        model = self.module.project_model(Path("/owned/AcceptanceTests.swift"))
        targets = [o for o in model["objects"].values() if o.get("isa") == "PBXNativeTarget"]
        self.assertEqual(len(targets), 1)
        self.assertEqual(targets[0]["productType"], "com.apple.product-type.bundle.ui-testing")
        self.assertEqual(targets[0]["dependencies"], [])
        self.assertNotIn("com.jianlibao.app", json.dumps(model))
        for obj in model["objects"].values():
            if obj.get("isa") == "XCBuildConfiguration":
                settings = obj["buildSettings"]
                self.assertEqual(settings["CODE_SIGNING_ALLOWED"], "NO")
                self.assertNotIn("TEST_TARGET_NAME", settings)
                self.assertEqual(settings["SUPPORTED_PLATFORMS"], "iphonesimulator")

    def test_project_and_scheme_are_generated_only_in_a_new_directory(self):
        with tempfile.TemporaryDirectory(prefix="jianlibao-ui-project-") as directory:
            root = Path(directory)
            source = root / "AcceptanceTests.swift"
            source.write_text("import XCTest\n")
            destination = root / "new-harness"
            result = self.module.generate_project(destination, source)
            project = Path(result["project"])
            self.assertTrue((project / "project.pbxproj").is_file())
            scheme = ET.parse(Path(result["scheme"]))
            references = scheme.findall(".//BuildableReference")
            self.assertTrue(references)
            self.assertTrue(all(r.attrib["BlueprintName"] == "JianlibaoAcceptance" for r in references))
            self.assertTrue(all(r.attrib["BuildableName"].endswith(".xctest") for r in references))
            with self.assertRaises(FileExistsError):
                self.module.generate_project(destination, source)

    def test_openstep_serializer_quotes_paths_and_preserves_unicode(self):
        rendered = self.module.openstep({"path": '/owned/训练 "sample".swift', "children": ["A", "B"], "version": 60})
        self.assertIn('"version" = 60;', rendered)
        self.assertIn('训练 \\"sample\\".swift'.replace('\\\\', '\\'), rendered)
        self.assertIn('"children" = (', rendered)


if __name__ == "__main__":
    unittest.main()
