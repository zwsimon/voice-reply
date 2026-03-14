const {
  withXcodeProject,
  withDangerousMod,
  withEntitlementsPlist,
} = require("@expo/config-plugins");
const path = require("path");
const fs = require("fs");

const EXTENSION_NAME = "VoiceReplyKeyboard";
const SOURCE_DIR = path.join(__dirname, "keyboard-extension");

// ── Step 1: Copy Swift source files & plists into ios/VoiceReplyKeyboard/ ──
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

    // Add the extension target
    const extTarget = xcodeProject.addTarget(
      targetName,
      "app_extension",
      targetName,
      extensionBundleId
    );

    // Add source file
    xcodeProject.addSourceFile(
      `${targetName}/KeyboardViewController.swift`,
      { target: extTarget.uuid }
    );

    // Add Info.plist as a resource
    xcodeProject.addResourceFile(
      `${targetName}/Info.plist`,
      { target: extTarget.uuid }
    );

    // Build settings for the extension target
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
        cfg.buildSettings.CODE_SIGN_ENTITLEMENTS = `${targetName}/VoiceReplyKeyboard.entitlements`;
        cfg.buildSettings.INFOPLIST_FILE = `${targetName}/Info.plist`;
        cfg.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = `"${extensionBundleId}"`;
        cfg.buildSettings.SKIP_INSTALL = "YES";
      }
    });

    // Embed extension in the main app target
    const mainTarget = xcodeProject.getFirstTarget();
    if (mainTarget) {
      xcodeProject.addBuildPhase(
        [`${targetName}.appex`],
        "PBXCopyFilesBuildPhase",
        "Embed Foundation Extensions",
        mainTarget.uuid,
        "app_extension"
      );
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
  config = withKeyboardExtensionTarget(config);
  config = withAppGroupEntitlement(config);
  return config;
};
