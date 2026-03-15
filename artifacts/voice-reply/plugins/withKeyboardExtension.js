const {
  withXcodeProject,
  withDangerousMod,
  withEntitlementsPlist,
} = require("@expo/config-plugins");
const path = require("path");
const fs = require("fs");

const EXTENSION_NAME = "VoiceReplyKeyboard";
const SOURCE_DIR = path.join(__dirname, "keyboard-extension");

// ── Step 1a: Patch Podfile to fix Xcode 16+ "Unexpected duplicate tasks" ──
// The hermes-engine pod has a script phase with no declared outputs, which
// Xcode 16+ flags as an error. Setting always_out_of_date = '1' on it is
// equivalent to unchecking "Based on dependency analysis" — which suppresses
// the duplicate-tasks error without affecting functionality.
function withPodfileHermesFix(config) {
  return withDangerousMod(config, [
    "ios",
    (config) => {
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        "Podfile"
      );
      if (!fs.existsSync(podfilePath)) return config;

      let podfile = fs.readFileSync(podfilePath, "utf8");

      const fix = `
  # Fix: mark hermes-engine script phases as always_out_of_date to avoid
  # "Unexpected duplicate tasks" error in Xcode 16+ (no declared outputs).
  installer.pods_project.targets.each do |target|
    next unless target.name == 'hermes-engine'
    target.build_phases.each do |phase|
      next unless phase.respond_to?(:shell_script)
      phase.always_out_of_date = '1'
    end
  end
`;

      // Insert AFTER react_native_post_install(...) — must count parens because
      // the call spans multiple lines with nested parens, breaking simple regex.
      if (podfile.includes("react_native_post_install") && !podfile.includes("always_out_of_date")) {
        const marker = "react_native_post_install(";
        const start = podfile.indexOf(marker);
        if (start !== -1) {
          let depth = 0;
          let endIdx = start + marker.length - 1;
          for (let i = endIdx; i < podfile.length; i++) {
            if (podfile[i] === "(") depth++;
            else if (podfile[i] === ")") {
              depth--;
              if (depth === 0) { endIdx = i + 1; break; }
            }
          }
          podfile = podfile.slice(0, endIdx) + "\n" + fix + podfile.slice(endIdx);
          fs.writeFileSync(podfilePath, podfile);
        }
      }

      return config;
    },
  ]);
}

// ── Step 1b: Copy Swift source files & plists into ios/VoiceReplyKeyboard/ ──
function withKeyboardExtensionFiles(config) {
  return withDangerousMod(config, [
    "ios",
    (config) => {
      const iosDir = config.modRequest.platformProjectRoot;
      const extDir = path.join(iosDir, EXTENSION_NAME);
      fs.mkdirSync(extDir, { recursive: true });

      const bundleId =
        config.ios?.bundleIdentifier ?? "com.voicereply.app";
      const apiBase =
        process.env.VOICEREPLY_API_BASE ?? "";

      // Copy Swift file
      fs.copyFileSync(
        path.join(SOURCE_DIR, "KeyboardViewController.swift"),
        path.join(extDir, "KeyboardViewController.swift")
      );

      // Write Info.plist with real values substituted
      let infoPlist = fs.readFileSync(
        path.join(SOURCE_DIR, "Info.plist"),
        "utf8"
      );
      infoPlist = infoPlist.replace("VOICEREPLY_API_BASE_PLACEHOLDER", apiBase);
      fs.writeFileSync(path.join(extDir, "Info.plist"), infoPlist);

      // Write entitlements with real bundle ID
      let entitlements = fs.readFileSync(
        path.join(SOURCE_DIR, "VoiceReplyKeyboard.entitlements"),
        "utf8"
      );
      entitlements = entitlements.replace(
        "BUNDLE_ID_PLACEHOLDER",
        bundleId
      );
      fs.writeFileSync(
        path.join(extDir, "VoiceReplyKeyboard.entitlements"),
        entitlements
      );

      return config;
    },
  ]);
}

// ── Step 2: Add extension target to Xcode project ──
function withKeyboardExtensionTarget(config) {
  return withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;
    const bundleId =
      config.ios?.bundleIdentifier ?? "com.voicereply.app";
    const extensionBundleId = `${bundleId}.keyboard`;
    const targetName = EXTENSION_NAME;

    // Avoid double-adding
    const targets = xcodeProject.pbxNativeTargetSection();
    const alreadyAdded = Object.values(targets || {}).some(
      (t) => t && t.name === targetName
    );
    if (alreadyAdded) return config;

    // Add the extension target (creates native target + build phases + group)
    const extTarget = xcodeProject.addTarget(
      targetName,
      "app_extension",
      targetName,
      extensionBundleId
    );

    if (!extTarget) {
      console.warn("[withKeyboardExtension] addTarget returned null, skipping");
      return config;
    }

    // ── Manually add file references to avoid xcode library null-path bug ──

    const objects = xcodeProject.hash.project.objects;

    // Helper: generate UUID in xcode format
    const genUUID = () => xcodeProject.generateUuid();

    // 1. Add PBXFileReference for KeyboardViewController.swift
    const swiftFileRef = genUUID();
    objects["PBXFileReference"] = objects["PBXFileReference"] || {};
    objects["PBXFileReference"][swiftFileRef] = {
      isa: "PBXFileReference",
      lastKnownFileType: "sourcecode.swift",
      name: '"KeyboardViewController.swift"',
      path: `"${targetName}/KeyboardViewController.swift"`,
      sourceTree: '"<group>"',
    };
    objects["PBXFileReference"][`${swiftFileRef}_comment`] =
      "KeyboardViewController.swift";

    // 2. Add PBXBuildFile for the Swift source
    const swiftBuildFile = genUUID();
    objects["PBXBuildFile"] = objects["PBXBuildFile"] || {};
    objects["PBXBuildFile"][swiftBuildFile] = {
      isa: "PBXBuildFile",
      fileRef: swiftFileRef,
      fileRef_comment: "KeyboardViewController.swift",
    };
    objects["PBXBuildFile"][`${swiftBuildFile}_comment`] =
      "KeyboardViewController.swift in Sources";

    // 3. Add PBXFileReference for Info.plist
    const plistFileRef = genUUID();
    objects["PBXFileReference"][plistFileRef] = {
      isa: "PBXFileReference",
      lastKnownFileType: "text.plist.xml",
      name: '"Info.plist"',
      path: `"${targetName}/Info.plist"`,
      sourceTree: '"<group>"',
    };
    objects["PBXFileReference"][`${plistFileRef}_comment`] = "Info.plist";

    // 4. Add PBXBuildFile for Info.plist (resource)
    const plistBuildFile = genUUID();
    objects["PBXBuildFile"][plistBuildFile] = {
      isa: "PBXBuildFile",
      fileRef: plistFileRef,
      fileRef_comment: "Info.plist",
    };
    objects["PBXBuildFile"][`${plistBuildFile}_comment`] =
      "Info.plist in Resources";

    // 5. Find the extension target's PBXGroup and add file refs to it
    const groups = objects["PBXGroup"] || {};
    // addTarget creates a group with the same name as the target
    let extGroupKey = null;
    for (const [key, val] of Object.entries(groups)) {
      if (val && val.name === `"${targetName}"`) {
        extGroupKey = key;
        break;
      }
    }
    if (extGroupKey) {
      groups[extGroupKey].children = groups[extGroupKey].children || [];
      groups[extGroupKey].children.push(
        { value: swiftFileRef, comment: "KeyboardViewController.swift" },
        { value: plistFileRef, comment: "Info.plist" }
      );
    }

    // 6. Find the Sources build phase for our extension target and add Swift file
    const sourceBuildPhases = objects["PBXSourcesBuildPhase"] || {};
    const extTargetPhaseUUIDs = (
      extTarget.pbxNativeTarget.buildPhases || []
    ).map((p) => p.value);

    for (const phaseKey of extTargetPhaseUUIDs) {
      if (sourceBuildPhases[phaseKey]) {
        sourceBuildPhases[phaseKey].files =
          sourceBuildPhases[phaseKey].files || [];
        sourceBuildPhases[phaseKey].files.push({
          value: swiftBuildFile,
          comment: "KeyboardViewController.swift in Sources",
        });
        break;
      }
    }

    // 7. Find the Resources build phase for our extension target and add Info.plist
    const resourceBuildPhases = objects["PBXResourcesBuildPhase"] || {};
    for (const phaseKey of extTargetPhaseUUIDs) {
      if (resourceBuildPhases[phaseKey]) {
        resourceBuildPhases[phaseKey].files =
          resourceBuildPhases[phaseKey].files || [];
        resourceBuildPhases[phaseKey].files.push({
          value: plistBuildFile,
          comment: "Info.plist in Resources",
        });
        break;
      }
    }

    // ── Build settings for the extension target ──
    const buildConfig = xcodeProject.pbxXCBuildConfigurationSection();
    Object.keys(buildConfig).forEach((key) => {
      const cfg = buildConfig[key];
      if (
        cfg &&
        cfg.buildSettings &&
        cfg.buildSettings.PRODUCT_NAME === `"${targetName}"`
      ) {
        cfg.buildSettings.SWIFT_VERSION = "5.0";
        cfg.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = "16.0";
        cfg.buildSettings.CODE_SIGN_ENTITLEMENTS = `"${targetName}/VoiceReplyKeyboard.entitlements"`;
        cfg.buildSettings.INFOPLIST_FILE = `"${targetName}/Info.plist"`;
        cfg.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = `"${extensionBundleId}"`;
        cfg.buildSettings.SKIP_INSTALL = "YES";
        // Extensions must NOT embed Swift standard libraries — the host app
        // already does this. Both trying to embed causes "Unexpected duplicate
        // tasks" error in Xcode 15+.
        cfg.buildSettings.ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES = "NO";
        // Extensions must not re-export frameworks from the host app
        cfg.buildSettings.LD_RUNPATH_SEARCH_PATHS = [
          "$(inherited)",
          "@executable_path/../../Frameworks",
          "@executable_path/Frameworks",
        ].join(" ");
      }
    });

    // ── Embed extension in the main app target ──
    // Use the productReference UUID that addTarget already created (properly
    // parented in the Products group). Do NOT pass a string path to addBuildPhase
    // because xcodeproj gem will flag the resulting orphaned PBXFileReference.
    const mainTarget = xcodeProject.getFirstTarget();
    const productRef = extTarget.pbxNativeTarget.productReference;
    if (mainTarget && productRef) {
      const appexBuildFileUUID = genUUID();
      objects["PBXBuildFile"][appexBuildFileUUID] = {
        isa: "PBXBuildFile",
        fileRef: productRef,
        fileRef_comment: `${targetName}.appex`,
        settings: { ATTRIBUTES: ["RemoveHeadersOnCopy"] },
      };
      objects["PBXBuildFile"][`${appexBuildFileUUID}_comment`] =
        `${targetName}.appex in Embed Foundation Extensions`;

      const copyPhaseUUID = genUUID();
      objects["PBXCopyFilesBuildPhase"] =
        objects["PBXCopyFilesBuildPhase"] || {};
      objects["PBXCopyFilesBuildPhase"][copyPhaseUUID] = {
        isa: "PBXCopyFilesBuildPhase",
        buildActionMask: 2147483647,
        dstPath: '""',
        dstSubfolderSpec: 13,
        files: [
          {
            value: appexBuildFileUUID,
            comment: `${targetName}.appex in Embed Foundation Extensions`,
          },
        ],
        name: '"Embed Foundation Extensions"',
        runOnlyForDeploymentPostprocessing: 0,
      };
      objects["PBXCopyFilesBuildPhase"][`${copyPhaseUUID}_comment`] =
        "Embed Foundation Extensions";

      // Attach this phase to the main app target's buildPhases array
      const mainNativeTarget =
        xcodeProject.pbxNativeTargetSection()[mainTarget.uuid];
      if (mainNativeTarget) {
        mainNativeTarget.buildPhases = mainNativeTarget.buildPhases || [];
        mainNativeTarget.buildPhases.push({
          value: copyPhaseUUID,
          comment: "Embed Foundation Extensions",
        });
      }
    }

    return config;
  });
}

// ── Step 3: Add App Groups entitlement to main app target ──
function withAppGroupEntitlement(config) {
  return withEntitlementsPlist(config, (config) => {
    const bundleId =
      config.ios?.bundleIdentifier ?? "com.voicereply.app";
    const existing =
      config.modResults["com.apple.security.application-groups"] ?? [];
    const group = `group.${bundleId}`;
    if (!existing.includes(group)) {
      config.modResults["com.apple.security.application-groups"] = [
        ...existing,
        group,
      ];
    }
    return config;
  });
}

// ── Compose all steps ──
module.exports = function withKeyboardExtension(config) {
  config = withKeyboardExtensionFiles(config);
  config = withPodfileHermesFix(config);
  config = withKeyboardExtensionTarget(config);
  config = withAppGroupEntitlement(config);
  return config;
};
