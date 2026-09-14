#!/usr/bin/env python3
"""Generate the checked-in Xcode project using only Python's standard library.

No SDK/toolchain installation, signing, shell build phases or network calls.
Run after adding native files; --check compares without writing.
"""
import argparse
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]


def identifier(name):
    return hashlib.sha256(name.encode()).hexdigest()[:24].upper()


def serialize(value, level=0):
    indent = "\t" * level
    if isinstance(value, dict):
        lines = [f'{indent}\t{json.dumps(k)} = {serialize(v, level + 1)};' for k, v in value.items()]
        return "{\n" + "\n".join(lines) + "\n" + indent + "}"
    if isinstance(value, list):
        return "(" + ", ".join(serialize(v, level) for v in value) + ")"
    return json.dumps(str(value))


def generate():
    objects = {}

    def obj(object_name, isa, **fields):
        key = identifier(object_name)
        objects[key] = dict(isa=isa, **fields)
        return key

    def configs(name, extra):
        entries = []
        for mode in ("Debug", "Release"):
            settings = dict(extra)
            if mode == "Debug":
                settings.update(SWIFT_ACTIVE_COMPILATION_CONDITIONS="$(inherited) DEBUG", SWIFT_OPTIMIZATION_LEVEL="-Onone", ENABLE_TESTABILITY="YES")
            else:
                settings.update(SWIFT_COMPILATION_MODE="wholemodule", SWIFT_OPTIMIZATION_LEVEL="-O")
            entries.append(obj(f"{name}/{mode}", "XCBuildConfiguration", name=mode, buildSettings=settings))
        return obj(f"{name}/configs", "XCConfigurationList", buildConfigurations=entries,
                   defaultConfigurationIsVisible=0, defaultConfigurationName="Release")

    files = sorted(p.relative_to(ROOT).as_posix() for folder in ("App", "Shared", "PacketTunnel", "Tests", "UITests", "Configuration")
                   for p in (ROOT / folder).glob("*") if p.is_file())
    refs = {}
    for path in files:
        extension = Path(path).suffix
        kind = {".swift": "sourcecode.swift", ".plist": "text.plist.xml", ".entitlements": "text.plist.entitlements",
                ".xcprivacy": "text.xml", ".json": "text.json"}[extension]
        refs[path] = obj(path, "PBXFileReference", path=path, sourceTree="SOURCE_ROOT", lastKnownFileType=kind)

    definitions = {
        "Tono": ("application", "app", ["App/", "Shared/"], "com.ninx.tono"),
        "PacketTunnel": ("app-extension", "appex", ["PacketTunnel/", "Shared/"], "com.ninx.tono.PacketTunnel"),
        "TonoTests": ("bundle.unit-test", "xctest", ["Tests/"], "com.ninx.tono.Tests"),
        "TonoUITests": ("bundle.ui-testing", "xctest", ["UITests/"], "com.ninx.tono.UITests"),
    }
    products = {}
    for name, (_, ext, _, _) in definitions.items():
        products[name] = obj(f"{name}/product", "PBXFileReference", path=f"{name}.{ext}", sourceTree="BUILT_PRODUCTS_DIR",
                             explicitFileType={"app": "wrapper.application", "appex": "wrapper.app-extension", "xctest": "wrapper.cfbundle"}[ext], includeInIndex=0)
    groups = [obj(f"group/{folder}", "PBXGroup", name=folder, sourceTree="<group>",
                  children=[refs[p] for p in files if p.startswith(folder + "/")])
              for folder in ("App", "Shared", "PacketTunnel", "Tests", "UITests", "Configuration")]
    product_group = obj("products", "PBXGroup", name="Products", sourceTree="<group>", children=list(products.values()))
    main_group = obj("main-group", "PBXGroup", sourceTree="<group>", children=groups + [product_group])
    targets = []
    for name, (kind, _, prefixes, bundle) in definitions.items():
        source_files = [obj(f"{name}/build/{p}", "PBXBuildFile", fileRef=refs[p])
                        for p in files if p.endswith(".swift") and any(p.startswith(prefix) for prefix in prefixes)]
        sources = obj(f"{name}/sources", "PBXSourcesBuildPhase", buildActionMask=2147483647, files=source_files, runOnlyForDeploymentPostprocessing=0)
        resource_files = []
        if name in ("Tono", "PacketTunnel"):
            resource_files.append(obj(f"{name}/privacy", "PBXBuildFile", fileRef=refs["Configuration/PrivacyInfo.xcprivacy"]))
        resources = obj(f"{name}/resources", "PBXResourcesBuildPhase", buildActionMask=2147483647, files=resource_files, runOnlyForDeploymentPostprocessing=0)
        frameworks = obj(f"{name}/frameworks", "PBXFrameworksBuildPhase", buildActionMask=2147483647, files=[], runOnlyForDeploymentPostprocessing=0)
        phases = [sources, frameworks, resources]
        dependencies = []
        depends = "PacketTunnel" if name == "Tono" else "Tono" if name in ("TonoTests", "TonoUITests") else None
        if depends:
            proxy = obj(f"{name}/proxy", "PBXContainerItemProxy", containerPortal=identifier("project"), proxyType=1,
                        remoteGlobalIDString=identifier(f"{depends}/target"), remoteInfo=depends)
            dependencies.append(obj(f"{name}/dependency", "PBXTargetDependency", target=identifier(f"{depends}/target"), targetProxy=proxy))
        if name == "Tono":
            embedded = obj("embed-extension", "PBXBuildFile", fileRef=products["PacketTunnel"], settings={"ATTRIBUTES": ["RemoveHeadersOnCopy"]})
            phases.append(obj("embed-phase", "PBXCopyFilesBuildPhase", name="Embed App Extensions", buildActionMask=2147483647,
                              dstPath="", dstSubfolderSpec=13, files=[embedded], runOnlyForDeploymentPostprocessing=0))
        settings = {"PRODUCT_BUNDLE_IDENTIFIER": bundle, "PRODUCT_NAME": "$(TARGET_NAME)", "CODE_SIGN_STYLE": "Automatic",
                    "LD_RUNPATH_SEARCH_PATHS": ["$(inherited)", "@executable_path/Frameworks", "@executable_path/../../Frameworks"]}
        if name in ("Tono", "PacketTunnel"):
            config = "App" if name == "Tono" else name
            settings.update(INFOPLIST_FILE=f"Configuration/{config}-Info.plist", CODE_SIGN_ENTITLEMENTS=f"Configuration/{config}.entitlements")
        else:
            settings.update(GENERATE_INFOPLIST_FILE="YES")
        if name == "PacketTunnel":
            settings.update(APPLICATION_EXTENSION_API_ONLY="YES", SKIP_INSTALL="YES")
        if name == "TonoTests":
            settings.update(TEST_HOST="$(BUILT_PRODUCTS_DIR)/Tono.app/Tono", BUNDLE_LOADER="$(TEST_HOST)")
        if name == "TonoUITests":
            settings.update(TEST_TARGET_NAME="Tono")
        targets.append(obj(f"{name}/target", "PBXNativeTarget", name=name, productName=name, productReference=products[name],
                           productType=f"com.apple.product-type.{kind}", buildConfigurationList=configs(name, settings),
                           buildPhases=phases, buildRules=[], dependencies=dependencies))
    project_configs = configs("project", {"SDKROOT": "iphoneos", "IPHONEOS_DEPLOYMENT_TARGET": "26.0", "SWIFT_VERSION": "5.0",
                                          "SWIFT_STRICT_CONCURRENCY": "complete", "CLANG_ENABLE_MODULES": "YES", "TARGETED_DEVICE_FAMILY": "1,2",
                                          "SUPPORTED_PLATFORMS": "iphoneos iphonesimulator", "SUPPORTS_MACCATALYST": "NO",
                                          "MARKETING_VERSION": "0.1.0", "CURRENT_PROJECT_VERSION": "1", "TONO_DISTRIBUTION": "testflight"})
    root = obj("project", "PBXProject", attributes={"LastUpgradeCheck": "2600", "BuildIndependentTargetsInParallel": "YES"},
               buildConfigurationList=project_configs, compatibilityVersion="Xcode 14.0", developmentRegion="en", hasScannedForEncodings=0,
               knownRegions=["en", "Base"], mainGroup=main_group, productRefGroup=product_group, projectDirPath="", projectRoot="", targets=targets)
    project = "// !$*UTF8*$!\n" + serialize(dict(archiveVersion=1, classes={}, objectVersion=56, objects=objects, rootObject=root)) + "\n"

    scheme = ET.Element("Scheme", LastUpgradeVersion="2600", version="1.3")

    def reference(parent, target):
        ext = definitions[target][1]
        ET.SubElement(parent, "BuildableReference", BuildableIdentifier="primary", BlueprintIdentifier=identifier(f"{target}/target"),
                      BuildableName=f"{target}.{ext}", BlueprintName=target, ReferencedContainer="container:Tono.xcodeproj")

    action = ET.SubElement(scheme, "BuildAction", parallelizeBuildables="YES", buildImplicitDependencies="YES")
    entries = ET.SubElement(action, "BuildActionEntries")
    entry = ET.SubElement(entries, "BuildActionEntry", buildForTesting="YES", buildForRunning="YES", buildForProfiling="YES", buildForArchiving="YES", buildForAnalyzing="YES")
    reference(entry, "Tono")
    test = ET.SubElement(scheme, "TestAction", buildConfiguration="Debug", selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB",
                         selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB", shouldUseLaunchSchemeArgsEnv="YES")
    testables = ET.SubElement(test, "Testables")
    for target in ("TonoTests", "TonoUITests"):
        reference(ET.SubElement(testables, "TestableReference", skipped="NO"), target)
    launch = ET.SubElement(scheme, "LaunchAction", buildConfiguration="Debug", selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB",
                           selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB", launchStyle="0", useCustomWorkingDirectory="NO",
                           ignoresPersistentStateOnLaunch="NO", debugDocumentVersioning="YES", debugServiceExtension="internal", allowLocationSimulation="YES")
    reference(ET.SubElement(launch, "BuildableProductRunnable", runnableDebuggingMode="0"), "Tono")
    profile = ET.SubElement(scheme, "ProfileAction", buildConfiguration="Release", shouldUseLaunchSchemeArgsEnv="YES", useCustomWorkingDirectory="NO", debugDocumentVersioning="YES")
    reference(ET.SubElement(profile, "BuildableProductRunnable", runnableDebuggingMode="0"), "Tono")
    ET.SubElement(scheme, "AnalyzeAction", buildConfiguration="Debug")
    ET.SubElement(scheme, "ArchiveAction", buildConfiguration="Release", revealArchiveInOrganizer="YES")
    ET.indent(scheme)
    return {"Tono.xcodeproj/project.pbxproj": project,
            "Tono.xcodeproj/xcshareddata/xcschemes/Tono.xcscheme": ET.tostring(scheme, encoding="unicode") + "\n"}, objects


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    outputs, _ = generate()
    for relative, text in outputs.items():
        path = ROOT / relative
        if args.check:
            if not path.exists() or path.read_text() != text:
                raise SystemExit(f"Generated project drift: {relative}")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
    print("Xcode project matches native sources" if args.check else "Generated Xcode project (not an Xcode build)")
