"""Generate a standalone Simulator UI-test project, never the application project."""
import json
from pathlib import Path
import xml.etree.ElementTree as ET

NAME = "JianlibaoAcceptance"
TARGET = "D10A00000000000000000001"


def openstep(value, level=0):
    """The small property-list value types used by this generated PBX project."""
    indent = "\t" * level
    if isinstance(value, dict):
        return "{\n" + "".join(indent + "\t" + json.dumps(k, ensure_ascii=False) + " = " + openstep(v, level + 1) + ";\n" for k, v in value.items()) + indent + "}"
    if isinstance(value, list):
        return "(\n" + "".join(indent + "\t" + openstep(v, level + 1) + ",\n" for v in value) + indent + ")"
    if isinstance(value, int):
        return str(value)
    return json.dumps(value, ensure_ascii=False)


def project_model(source):
    root, group, products, source_ref, product_ref, build_file, sources, frameworks, resources, configs, debug = [
        f"D10A000000000000000000{i:02X}" for i in range(2, 13)]
    settings = {"SDKROOT": "iphonesimulator", "SUPPORTED_PLATFORMS": "iphonesimulator",
                "IPHONEOS_DEPLOYMENT_TARGET": "18.0", "TARGETED_DEVICE_FAMILY": "1,2",
                "CODE_SIGNING_ALLOWED": "NO", "CODE_SIGNING_REQUIRED": "NO", "CODE_SIGN_IDENTITY": "",
                "GENERATE_INFOPLIST_FILE": "YES", "PRODUCT_BUNDLE_IDENTIFIER": "com.jianlibao.acceptance",
                "PRODUCT_NAME": "$(TARGET_NAME)", "SWIFT_VERSION": "5.0", "CLANG_ENABLE_MODULES": "YES",
                "ENABLE_TESTING_SEARCH_PATHS": "YES", "LD_RUNPATH_SEARCH_PATHS": ["$(inherited)", "@executable_path/Frameworks", "@loader_path/Frameworks"]}
    objects = {
        TARGET: {"isa": "PBXNativeTarget", "buildConfigurationList": configs,
                 "buildPhases": [sources, frameworks, resources], "buildRules": [], "dependencies": [],
                 "name": NAME, "productName": NAME, "productReference": product_ref,
                 "productType": "com.apple.product-type.bundle.ui-testing"},
        root: {"isa": "PBXProject", "attributes": {"BuildIndependentTargetsInParallel": "YES", "LastUpgradeCheck": "2600"},
               "buildConfigurationList": configs, "compatibilityVersion": "Xcode 14.0", "developmentRegion": "en",
               "hasScannedForEncodings": 0, "knownRegions": ["en", "Base"], "mainGroup": group,
               "productRefGroup": products, "projectDirPath": "", "projectRoot": "", "targets": [TARGET]},
        group: {"isa": "PBXGroup", "children": [source_ref, products], "sourceTree": "<group>"},
        products: {"isa": "PBXGroup", "name": "Products", "children": [product_ref], "sourceTree": "<group>"},
        source_ref: {"isa": "PBXFileReference", "lastKnownFileType": "sourcecode.swift", "path": str(Path(source).resolve()), "sourceTree": "<absolute>"},
        product_ref: {"isa": "PBXFileReference", "explicitFileType": "wrapper.cfbundle", "includeInIndex": 0, "path": NAME + ".xctest", "sourceTree": "BUILT_PRODUCTS_DIR"},
        build_file: {"isa": "PBXBuildFile", "fileRef": source_ref},
        sources: {"isa": "PBXSourcesBuildPhase", "buildActionMask": 2147483647, "files": [build_file], "runOnlyForDeploymentPostprocessing": 0},
        frameworks: {"isa": "PBXFrameworksBuildPhase", "buildActionMask": 2147483647, "files": [], "runOnlyForDeploymentPostprocessing": 0},
        resources: {"isa": "PBXResourcesBuildPhase", "buildActionMask": 2147483647, "files": [], "runOnlyForDeploymentPostprocessing": 0},
        configs: {"isa": "XCConfigurationList", "buildConfigurations": [debug], "defaultConfigurationIsVisible": 0, "defaultConfigurationName": "Debug"},
        debug: {"isa": "XCBuildConfiguration", "buildSettings": settings, "name": "Debug"},
    }
    return {"archiveVersion": 1, "classes": {}, "objectVersion": 60, "objects": objects, "rootObject": root}


def generate_project(destination, source):
    destination, source = Path(destination), Path(source)
    if not source.is_file():
        raise FileNotFoundError(source)
    destination.mkdir(parents=True, exist_ok=False)
    project = destination / (NAME + ".xcodeproj")
    project.mkdir()
    (project / "project.pbxproj").write_text("// !$*UTF8*$!\n" + openstep(project_model(source)) + "\n", encoding="utf-8")
    scheme = ET.Element("Scheme", {"LastUpgradeVersion": "2600", "version": "1.7"})
    build = ET.SubElement(scheme, "BuildAction", {"parallelizeBuildables": "YES", "buildImplicitDependencies": "NO"})
    entry = ET.SubElement(ET.SubElement(build, "BuildActionEntries"), "BuildActionEntry", {"buildForTesting": "YES", "buildForRunning": "NO", "buildForProfiling": "NO", "buildForArchiving": "NO", "buildForAnalyzing": "YES"})
    attrs = {"BuildableIdentifier": "primary", "BlueprintIdentifier": TARGET, "BuildableName": NAME + ".xctest", "BlueprintName": NAME, "ReferencedContainer": "container:" + NAME + ".xcodeproj"}
    ET.SubElement(entry, "BuildableReference", attrs)
    action = ET.SubElement(scheme, "TestAction", {"buildConfiguration": "Debug", "selectedDebuggerIdentifier": "Xcode.DebuggerFoundation.Debugger.LLDB", "selectedLauncherIdentifier": "Xcode.IDEFoundation.Launcher.LLDB", "shouldUseLaunchSchemeArgsEnv": "YES"})
    testable = ET.SubElement(ET.SubElement(action, "Testables"), "TestableReference", {"skipped": "NO", "parallelizable": "NO"})
    ET.SubElement(testable, "BuildableReference", attrs)
    scheme_path = project / "xcshareddata/xcschemes" / (NAME + ".xcscheme")
    scheme_path.parent.mkdir(parents=True)
    ET.ElementTree(scheme).write(scheme_path, encoding="utf-8", xml_declaration=True)
    return {"project": str(project), "scheme": str(scheme_path), "name": NAME}
