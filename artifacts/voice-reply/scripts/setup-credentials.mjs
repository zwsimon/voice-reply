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
 *   2. Uses `fastlane sigh` to create / download an Ad Hoc profile for
 *      com.voicereply.app.keyboard from Apple's portal.
 *   3. Writes a credentials.json that references all three local files so
 *      EAS can use credentialsSource:"local" for the build.
 *
 * Required env vars:
 *   EXPO_TOKEN, EXPO_APPLE_ID, EXPO_APPLE_APP_SPECIFIC_PASSWORD,
 *   EXPO_APPLE_TEAM_ID (default 54R8ZW3P7Q)
 */

import https from "https";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const CREDS_DIR = path.join(PROJECT_ROOT, "creds");

const EXPO_TOKEN = process.env.EXPO_TOKEN;
const EXPO_APPLE_ID = process.env.EXPO_APPLE_ID;
const EXPO_APPLE_APP_SPECIFIC_PASSWORD =
  process.env.EXPO_APPLE_APP_SPECIFIC_PASSWORD;
const EXPO_APPLE_TEAM_ID = process.env.EXPO_APPLE_TEAM_ID || "54R8ZW3P7Q";

const EAS_FULL_NAME = "@vbcoder/voice-reply";
const EXT_BUNDLE_ID = "com.voicereply.app.keyboard";
const EXT_TARGET_NAME = "VoiceReplyKeyboard";

// ---------------------------------------------------------------------------
// GraphQL helper
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

// ---------------------------------------------------------------------------
// Step 1 — fetch existing credentials from EAS
// ---------------------------------------------------------------------------
async function fetchEASCredentials() {
  console.log("📡  Fetching EAS credentials via GraphQL...");
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
  if (!allCreds.length) throw new Error("No iOS credentials found in EAS vault");

  // Find Ad Hoc build credentials
  let adhoc = null;
  for (const appCred of allCreds) {
    adhoc = (appCred.iosAppBuildCredentialsList ?? []).find(
      (c) => c.iosDistributionType === "AD_HOC"
    );
    if (adhoc) break;
  }
  if (!adhoc)
    throw new Error("No AD_HOC build credentials found in EAS vault");

  const cert = adhoc.distributionCertificate;
  const profile = adhoc.provisioningProfile;
  if (!cert?.certificateP12) throw new Error("Distribution cert data missing");
  if (!profile?.provisioningProfile)
    throw new Error("Main app profile data missing");

  console.log(`✅  Distribution cert serial: ${cert.serialNumber}`);
  console.log(
    `✅  Main app profile ID:     ${profile.developerPortalIdentifier}`
  );
  return { cert, profile };
}

// ---------------------------------------------------------------------------
// Step 2 — create the extension Ad Hoc profile via fastlane sigh
// ---------------------------------------------------------------------------
function createExtensionProfile() {
  console.log(`\n🍎  Creating Ad Hoc profile for ${EXT_BUNDLE_ID} via fastlane sigh...`);

  const env = {
    ...process.env,
    FASTLANE_USER: EXPO_APPLE_ID,
    FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD:
      EXPO_APPLE_APP_SPECIFIC_PASSWORD,
    FASTLANE_TEAM_ID: EXPO_APPLE_TEAM_ID,
    FASTLANE_DISABLE_COLORS: "1",
    CI: "true",
  };

  // Ensure the App ID exists first (idempotent — skips if already present)
  try {
    console.log("  → fastlane produce (register App ID if missing)...");
    execSync(
      [
        "fastlane produce",
        `--app_identifier "${EXT_BUNDLE_ID}"`,
        `--team_id "${EXPO_APPLE_TEAM_ID}"`,
        "--skip_itc",
      ].join(" "),
      { stdio: "inherit", env }
    );
  } catch (err) {
    // "already exists" prints to stderr and exits 0 in most fastlane versions;
    // treat any non-zero exit as a warning and continue to sigh.
    console.warn("  ⚠️  fastlane produce exited non-zero (may already exist):", err.message);
  }

  // Download / create the Ad Hoc profile
  console.log("  → fastlane sigh (create/download Ad Hoc profile)...");
  execSync(
    [
      "fastlane sigh",
      `--app_identifier "${EXT_BUNDLE_ID}"`,
      "--adhoc",
      `--team_id "${EXPO_APPLE_TEAM_ID}"`,
      `--output_path "${CREDS_DIR}"`,
      '--filename "ext_profile.mobileprovision"',
      "--skip_certificate_verification",
      "--force",
    ].join(" "),
    { stdio: "inherit", env }
  );

  const extProfilePath = path.join(CREDS_DIR, "ext_profile.mobileprovision");
  if (!fs.existsSync(extProfilePath))
    throw new Error("ext_profile.mobileprovision was not created by sigh");

  console.log("✅  Extension profile created.");
  return extProfilePath;
}

// ---------------------------------------------------------------------------
// Step 3 — write local cert/profile files + credentials.json
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

  for (const [name, val] of [
    ["EXPO_TOKEN", EXPO_TOKEN],
    ["EXPO_APPLE_ID", EXPO_APPLE_ID],
    ["EXPO_APPLE_APP_SPECIFIC_PASSWORD", EXPO_APPLE_APP_SPECIFIC_PASSWORD],
  ]) {
    if (!val) {
      console.error(`❌  Missing required env var: ${name}`);
      process.exit(1);
    }
  }

  try {
    const { cert, profile } = await fetchEASCredentials();
    writeCredentials(cert, profile);         // write cert + main profile NOW
    createExtensionProfile();               // fastlane needs creds dir to exist
    console.log("\n✅  All credentials ready — proceeding to eas build.\n");
  } catch (err) {
    console.error("\n❌  setup-credentials failed:", err.message);
    process.exit(1);
  }
})();
