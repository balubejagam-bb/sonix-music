const fs = require('fs');
const path = require('path');

const manifestPath = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');

function hasPattern(text, pattern) {
  return pattern.test(text);
}

function check(name, ok, hint = '') {
  const icon = ok ? 'PASS' : 'FAIL';
  const line = `${icon} ${name}`;
  if (ok) {
    console.log(line);
  } else {
    console.log(`${line}${hint ? ` -> ${hint}` : ''}`);
  }
  return ok;
}

function main() {
  if (!fs.existsSync(manifestPath)) {
    console.error(`FAIL Manifest not found: ${manifestPath}`);
    process.exit(1);
  }

  const xml = fs.readFileSync(manifestPath, 'utf8');
  let allOk = true;

  console.log('Android Playback Checklist Verification');
  console.log(`Manifest: ${manifestPath}`);
  console.log('');

  allOk = check(
    'INTERNET permission',
    hasPattern(xml, /<uses-permission\s+android:name="android\.permission\.INTERNET"\s*\/>/)
  ) && allOk;

  allOk = check(
    'WAKE_LOCK permission',
    hasPattern(xml, /<uses-permission\s+android:name="android\.permission\.WAKE_LOCK"\s*\/>/)
  ) && allOk;

  allOk = check(
    'FOREGROUND_SERVICE permission',
    hasPattern(xml, /<uses-permission\s+android:name="android\.permission\.FOREGROUND_SERVICE"\s*\/>/),
    'Required for persistent media controls in background.'
  ) && allOk;

  allOk = check(
    'FOREGROUND_SERVICE_MEDIA_PLAYBACK permission',
    hasPattern(xml, /<uses-permission\s+android:name="android\.permission\.FOREGROUND_SERVICE_MEDIA_PLAYBACK"\s*\/>/),
    'Required on newer Android versions for media playback service.'
  ) && allOk;

  allOk = check(
    'POST_NOTIFICATIONS permission',
    hasPattern(xml, /<uses-permission\s+android:name="android\.permission\.POST_NOTIFICATIONS"\s*\/>/),
    'Needed to reliably show playback notifications on Android 13+.'
  ) && allOk;

  allOk = check(
    'MainActivity launchMode=singleTask',
    hasPattern(xml, /<activity[\s\S]*?android:name="\.MainActivity"[\s\S]*?android:launchMode="singleTask"/),
    'Helps avoid duplicate activity instances disrupting playback state.'
  ) && allOk;

  allOk = check(
    'MusicPlaybackService declared',
    hasPattern(xml, /<service[\s\S]*?android:name="\.MusicPlaybackService"/),
    'Service declaration missing for foreground media playback.'
  ) && allOk;

  allOk = check(
    'MusicPlaybackService foregroundServiceType=mediaPlayback',
    hasPattern(xml, /<service[\s\S]*?android:name="\.MusicPlaybackService"[\s\S]*?android:foregroundServiceType="mediaPlayback"/),
    'Set mediaPlayback foreground service type for reliable controls.'
  ) && allOk;

  allOk = check(
    'MediaSessionService intent filter action',
    hasPattern(xml, /<action\s+android:name="androidx\.media3\.session\.MediaSessionService"\s*\/>/),
    'Required for media session integration.'
  ) && allOk;

  console.log('');
  if (allOk) {
    console.log('All Android playback checklist items passed.');
    process.exit(0);
  }

  console.log('One or more checklist items failed. Please update AndroidManifest.xml and re-run verification.');
  process.exit(2);
}

main();
