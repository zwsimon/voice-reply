#!/usr/bin/env node
/**
 * Pre-build credential setup for EAS.
 *
 * Runs on the GitHub Actions (Ubuntu) runner BEFORE `eas build`.
 * Because EAS only stores credentials for com.voicereply.app and skips
 * Apple auth in non-interactive mode when the main app already has remote
 * credentials, the extension bundle ID never gets a profile.
 *
 * This script:
 *   1. Fetches the distribution cert (p12 + password) and main app Ad Hoc
 *      provisioning profile from EAS's GraphQL API using EXPO_TOKEN.
 *   2. Authenticates with Apple using @expo/apple-utils (bundled in eas-cli)
 *      — supports app-specific passwords, no regular password required.
 *   3. Ensures the extension App ID (com.voicereply.app.keyboard) exists.
 *   4. Creates an Ad Hoc provisioning profile for the extension.
 *   5. Writes credentials.json so EAS uses credentialsSource:"local".
 *
 * Required env vars:
 *   EXPO_TOKEN, EXPO_APPLE_ID, EXPO_APPLE_APP_SPECIFIC_PASSWORD,
 *   EXPO_APPLE_TEAM_ID (default 54R8ZW3P7Q)
 */

import https from "https";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const CREDS_DIR = path.join(PROJECT_ROOT, "creds");

const EXPO_TOKEN = process.env.EXPO_TOKEN;
const EXPO_APPLE_ID = process.env.EXPO_APPLE_ID;
const EXPO_APPLE_APP_SPECIFIC_PASSWORD =
  process.env.EXPO_APPLE_APP_SPECIFIC_PASSWORD;
const EXPO_APPLE_TEAM_ID = process.env.EXPO_APPLE_TEAM_ID || "54R8ZW3P7Q";

// Optional: supply a pre-downloaded extension profile as base64 to skip Apple auth.
// If set, Apple authentication is skipped entirely.
const APPLE_EXT_PROFILE_BASE64 = process.env.APPLE_EXT_PROFILE_BASE64;

const EAS_FULL_NAME = "@vbcoder/voice-reply";
const MAIN_BUNDLE_ID = "com.voicereply.app";
const EXT_BUNDLE_ID = "com.voicereply.app.keyboard";
const DIST_CERT_SERIAL = "2E75D0534CCBE226B49F4492AB486201";
const EXT_TARGET_NAME = "VoiceReplyKeyboard";
const EXT_PROFILE_NAME = "VoiceReply Keyboard Ad Hoc";

// ---------------------------------------------------------------------------
// Resolve @expo/apple-utils from the installed eas-cli
// ---------------------------------------------------------------------------
function resolveAppleUtils() {
  const easBin = execSync("which eas").toString().trim();

  // Resolve the symlink so we get the real file location
  // (expo-github-action puts eas in node_modules/.bin which is a symlink)
  let realEas = easBin;
  try {
    realEas = execSync(`readlink -f "${easBin}"`).toString().trim();
  } catch (_) {
    // readlink not available — fall back to the symlink path
  }
  console.log(`eas binary → ${realEas}`);

  // Walk up the directory tree from the resolved binary, checking both:
  //   <dir>/@expo/apple-utils/build/index.js          (dir is already node_modules)
  //   <dir>/node_modules/@expo/apple-utils/build/index.js
  let dir = path.dirname(realEas);
  for (let depth = 0; depth < 12; depth++) {
    for (const candidate of [
      path.join(dir, "@expo", "apple-utils", "build", "index.js"),
      path.join(dir, "node_modules", "@expo", "apple-utils", "build", "index.js"),
    ]) {
      if (fs.existsSync(candidate)) {
        console.log(`✅  Found @expo/apple-utils at ${candidate}`);
        const req = createRequire(candidate);
        return req(candidate);
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root — give up
    dir = parent;
  }

  throw new Error(
    `@expo/apple-utils not found after walking up from ${path.dirname(realEas)}.\n` +
    `eas symlink: ${easBin}  real: ${realEas}`
  );
}

// ---------------------------------------------------------------------------
// GraphQL helper — fetch EAS-stored credentials
// ---------------------------------------------------------------------------
function graphql(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const req = https.request(
      {
        hostname: "api.expo.dev",
        port: 443,
        path: "/graphql",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${EXPO_TOKEN}`,
          "expo-client-info": JSON.stringify({
            clientId: "eas-cli",
            version: "18.3.0",
          }),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.errors) reject(new Error(JSON.stringify(parsed.errors)));
            else resolve(parsed.data);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function fetchEASCredentials() {
  console.log("📡  Fetching EAS credentials via GraphQL...");

  // ── Try 1: app-level credentials (normal path) ───────────────────────────
  const data = await graphql(`{
    app {
      byFullName(fullName: "${EAS_FULL_NAME}") {
        id
        iosAppCredentials {
          id
          appleTeam { appleTeamIdentifier }
          iosAppBuildCredentialsList {
            id
            iosDistributionType
            distributionCertificate {
              id
              certificateP12
              certificatePassword
              serialNumber
            }
            provisioningProfile {
              id
              provisioningProfile
              developerPortalIdentifier
            }
          }
        }
      }
    }
  }`);

  const app = data?.app?.byFullName;
  if (!app) throw new Error("App not found in EAS — check EXPO_TOKEN");

  const allCreds = app.iosAppCredentials ?? [];
  let adhoc = null;
  for (const appCred of allCreds) {
    adhoc = (appCred.iosAppBuildCredentialsList ?? []).find(
      (c) => c.iosDistributionType === "AD_HOC"
    );
    if (adhoc) break;
  }

  if (adhoc?.distributionCertificate?.certificateP12 && adhoc?.provisioningProfile?.provisioningProfile) {
    const cert = adhoc.distributionCertificate;
    const profile = adhoc.provisioningProfile;
    console.log(`✅  Distribution cert serial: ${cert.serialNumber}`);
    console.log(`✅  Main app profile ID:     ${profile.developerPortalIdentifier}`);
    return { cert, profile };
  }

  // ── Try 2: account-level fallback (project config was deleted from EAS UI) ──
  console.log("⚠️  Project-level credentials missing — trying account-level fallback...");
  const EAS_ACCOUNT = EAS_FULL_NAME.split("/")[0];

  const acctData = await graphql(`{
    account {
      byName(accountName: "${EAS_ACCOUNT}") {
        appleDistributionCertificates {
          id
          certificateP12
          certificatePassword
          serialNumber
        }
        appleProvisioningProfiles {
          id
          provisioningProfile
          developerPortalIdentifier
          appleAppIdentifier { bundleIdentifier }
        }
      }
    }
  }`).catch(() => null);

  const acct = acctData?.account?.byName;
  if (!acct) throw new Error(
    "iOS credentials not found at app or account level.\n" +
    "The project credential configuration was deleted from EAS.\n" +
    "Fix: go to https://expo.dev/accounts/vbcoder/projects/voice-reply/credentials\n" +
    "and re-add the iOS bundle identifier com.voicereply.app with Ad Hoc credentials."
  );

  const certs = acct.appleDistributionCertificates ?? [];
  const cert = certs.find(c => c.serialNumber === DIST_CERT_SERIAL) ?? certs[0];
  if (!cert?.certificateP12) throw new Error("Distribution certificate not found in EAS account vault");

  const profiles = acct.appleProvisioningProfiles ?? [];
  const profile = profiles.find(
    p => p.appleAppIdentifier?.bundleIdentifier === MAIN_BUNDLE_ID
  ) ?? profiles.find(p => p.provisioningProfile);
  if (!profile?.provisioningProfile) throw new Error("Main app provisioning profile not found in EAS account vault");

  console.log(`✅  Distribution cert serial (account-level): ${cert.serialNumber}`);
  console.log(`✅  Main app profile ID (account-level):     ${profile.developerPortalIdentifier}`);
  return { cert, profile };
}

// ---------------------------------------------------------------------------
// Step 2 — create extension Ad Hoc profile via @expo/apple-utils
// ---------------------------------------------------------------------------
async function createExtensionProfile(appleUtils) {
  const {
    Auth,
    BundleId,
    Certificate,
    Device,
    Profile,
    ProfileType,
    isNameCollisionError,
  } = appleUtils;

  // --- 2a. Authenticate with Apple ----------------------------------------
  // Supports both app-specific passwords (xxxx-xxxx-xxxx-xxxx) and regular passwords.
  console.log("\n🍎  Authenticating with Apple...");
  let authState;
  try {
    authState = await Auth.loginWithUserCredentialsAsync({
      username: EXPO_APPLE_ID,
      password: EXPO_APPLE_APP_SPECIFIC_PASSWORD,
      teamId: EXPO_APPLE_TEAM_ID,
    });
  } catch (authErr) {
    // Provide a helpful error message for common auth failures
    const msg = authErr.message || String(authErr);
    if (msg.toLowerCase().includes("invalid") || msg.toLowerCase().includes("password")) {
      throw new Error(
        `Apple authentication failed: ${msg}\n\n` +
        `HELP: The EXPO_APPLE_APP_SPECIFIC_PASSWORD secret may be expired or revoked.\n` +
        `  • Go to https://appleid.apple.com → Security → App-Specific Passwords\n` +
        `  • Generate a new password (format: xxxx-xxxx-xxxx-xxxx)\n` +
        `  • Update the EXPO_APPLE_APP_SPECIFIC_PASSWORD GitHub Secret\n\n` +
        `ALTERNATIVE: Set APPLE_EXT_PROFILE_BASE64 secret with a pre-downloaded profile\n` +
        `  (see README for manual profile download instructions)`
      );
    }
    throw authErr;
  }
  console.log("✅  Apple authentication successful");

  // --- 2b. Ensure extension App ID exists ----------------------------------
  console.log(`\n🔍  Looking up App ID for ${EXT_BUNDLE_ID}...`);
  let bundleIdObj = await BundleId.findAsync(authState, {
    identifier: EXT_BUNDLE_ID,
  });
  if (!bundleIdObj) {
    console.log(`  → App ID not found — creating ${EXT_BUNDLE_ID}...`);
    bundleIdObj = await BundleId.createAsync(authState, {
      name: "VoiceReply Keyboard",
      identifier: EXT_BUNDLE_ID,
      platform: "IOS",
    });
    console.log(`✅  Created App ID: ${bundleIdObj.id}`);
  } else {
    console.log(`✅  Found existing App ID: ${bundleIdObj.id}`);
  }

  // --- 2c. Find distribution certificate -----------------------------------
  console.log(
    `\n🔍  Finding distribution certificate (serial ${DIST_CERT_SERIAL})...`
  );
  const allCerts = await Certificate.getAsync(authState, {
    query: { filter: { certificateType: "IOS_DISTRIBUTION" } },
  });
  let distCert = allCerts.find(
    (c) => c.attributes?.serialNumber === DIST_CERT_SERIAL
  );
  if (!distCert) {
    if (allCerts.length > 0) {
      console.warn(
        `  ⚠️  Serial not matched — falling back to first IOS_DISTRIBUTION cert`
      );
      distCert = allCerts[0];
    } else {
      throw new Error("No IOS_DISTRIBUTION certificate found on Apple portal");
    }
  }
  console.log(`✅  Using cert: ${distCert.id} (serial ${distCert.attributes?.serialNumber})`);

  // --- 2d. Get registered devices ------------------------------------------
  console.log("\n🔍  Fetching registered devices...");
  const devices = await Device.getAllIOSProfileDevicesAsync(authState);
  console.log(`✅  Found ${devices.length} registered device(s)`);

  // --- 2e. Create the Ad Hoc profile for the extension ---------------------
  console.log(`\n🔨  Creating Ad Hoc profile for ${EXT_BUNDLE_ID}...`);

  let extProfile;
  try {
    extProfile = await Profile.createAsync(authState, {
      bundleId: bundleIdObj.id,
      certificates: [distCert],
      devices: devices,
      name: EXT_PROFILE_NAME,
      profileType: ProfileType.IOS_APP_ADHOC,
    });
    console.log(`✅  Created new profile: ${extProfile.id}`);
  } catch (err) {
    if (isNameCollisionError && isNameCollisionError(err)) {
      // A profile with this name already exists — create with a unique suffix
      const ts = Date.now();
      console.warn(
        `  ⚠️  Name collision — retrying with timestamp suffix...`
      );
      extProfile = await Profile.createAsync(authState, {
        bundleId: bundleIdObj.id,
        certificates: [distCert],
        devices: devices,
        name: `${EXT_PROFILE_NAME} ${ts}`,
        profileType: ProfileType.IOS_APP_ADHOC,
      });
      console.log(`✅  Created profile (with suffix): ${extProfile.id}`);
    } else {
      throw err;
    }
  }

  // --- 2f. Extract and save profile content --------------------------------
  let profileContent = extProfile.attributes?.profileContent;

  // Some API responses omit profileContent; fetch full info if needed
  if (!profileContent) {
    console.log("  → profileContent not in create response — fetching full profile info...");
    const fullProfile = await Profile.infoAsync(authState, {
      id: extProfile.id,
      query: {},
    });
    profileContent = fullProfile?.attributes?.profileContent;
  }

  if (!profileContent) {
    throw new Error(
      "Profile was created but profileContent attribute is missing even after re-fetch"
    );
  }

  const profileBytes = Buffer.from(profileContent, "base64");
  const extProfilePath = path.join(CREDS_DIR, "ext_profile.mobileprovision");
  fs.writeFileSync(extProfilePath, profileBytes);
  console.log(`📄  Wrote ${extProfilePath} (${profileBytes.length} bytes)`);

  return extProfilePath;
}

// ---------------------------------------------------------------------------
// Step 3 — write cert/profile files + credentials.json
// ---------------------------------------------------------------------------
function writeCredentials(cert, mainProfile) {
  fs.mkdirSync(CREDS_DIR, { recursive: true });

  const certPath = path.join(CREDS_DIR, "dist_cert.p12");
  const mainProfilePath = path.join(CREDS_DIR, "main_profile.mobileprovision");

  fs.writeFileSync(certPath, Buffer.from(cert.certificateP12, "base64"));
  console.log(`📄  Wrote ${certPath}`);

  fs.writeFileSync(
    mainProfilePath,
    Buffer.from(mainProfile.provisioningProfile, "base64")
  );
  console.log(`📄  Wrote ${mainProfilePath}`);

  const credentialsJson = {
    ios: {
      distributionCertificate: {
        path: "creds/dist_cert.p12",
        password: cert.certificatePassword,
      },
      provisioningProfilePath: "creds/main_profile.mobileprovision",
      appExtensions: [
        {
          targetName: EXT_TARGET_NAME,
          bundleIdentifier: EXT_BUNDLE_ID,
          provisioningProfilePath: "creds/ext_profile.mobileprovision",
        },
      ],
    },
  };

  const credJsonPath = path.join(PROJECT_ROOT, "credentials.json");
  fs.writeFileSync(credJsonPath, JSON.stringify(credentialsJson, null, 2));
  console.log(`📄  Wrote ${credJsonPath}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  console.log("=== VoiceReply credential setup ===\n");

  if (!EXPO_TOKEN) {
    console.error("❌  Missing required env var: EXPO_TOKEN");
    process.exit(1);
  }

  try {
    const { cert, profile } = await fetchEASCredentials();

    // Write cert + main profile files first (creates creds/ dir)
    writeCredentials(cert, profile);

    // -----------------------------------------------------------------------
    // Extension profile — two paths:
    // PATH A (preferred): APPLE_EXT_PROFILE_BASE64 secret is pre-populated
    //   → decode and write directly, no Apple authentication needed
    // PATH B (automatic): authenticate with Apple via @expo/apple-utils
    //   → requires valid EXPO_APPLE_ID + EXPO_APPLE_APP_SPECIFIC_PASSWORD
    // -----------------------------------------------------------------------

    if (APPLE_EXT_PROFILE_BASE64) {
      console.log("\n📦  Using pre-supplied APPLE_EXT_PROFILE_BASE64 secret...");
      const profileBytes = Buffer.from(APPLE_EXT_PROFILE_BASE64, "base64");
      const extProfilePath = path.join(CREDS_DIR, "ext_profile.mobileprovision");
      fs.writeFileSync(extProfilePath, profileBytes);
      console.log(`📄  Wrote ${extProfilePath} (${profileBytes.length} bytes)`);

      // Validate the profile contains the correct bundle ID
      const profileStr = profileBytes.toString("binary");
      if (profileStr.includes(EXT_BUNDLE_ID)) {
        console.log(`✅  Profile bundle ID verified: ${EXT_BUNDLE_ID}`);
      } else if (profileStr.includes("com.voicereply.app")) {
        console.error(
          `\n❌  WRONG PROFILE: The APPLE_EXT_PROFILE_BASE64 secret contains the MAIN APP profile\n` +
          `    (com.voicereply.app), NOT the keyboard extension profile.\n\n` +
          `    You need to:\n` +
          `    1. Go to developer.apple.com → Certificates, Identifiers & Profiles → Profiles\n` +
          `    2. Create a NEW Ad Hoc profile for App ID: com.voicereply.app.keyboard\n` +
          `    3. Download it, base64-encode it, and update APPLE_EXT_PROFILE_BASE64 in GitHub Secrets`
        );
        process.exit(1);
      } else {
        console.warn(`⚠️   Could not verify bundle ID in profile — proceeding anyway`);
      }

      console.log("✅  Extension profile loaded from secret.");
    } else {
      // PATH B — Apple authentication required
      if (!EXPO_APPLE_ID || !EXPO_APPLE_APP_SPECIFIC_PASSWORD) {
        console.error(
          "❌  Extension profile requires either:\n" +
          "    • APPLE_EXT_PROFILE_BASE64 secret (pre-downloaded profile), OR\n" +
          "    • EXPO_APPLE_ID + EXPO_APPLE_APP_SPECIFIC_PASSWORD (for automatic creation)"
        );
        process.exit(1);
      }
      const appleUtils = resolveAppleUtils();
      await createExtensionProfile(appleUtils);
    }

    console.log("\n✅  All credentials ready — proceeding to eas build.\n");
  } catch (err) {
    console.error("\n❌  setup-credentials failed:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();
