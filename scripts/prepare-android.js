const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const apiDir = path.join(root, 'src', 'app', 'api');
const apiBackupDir = path.join(root, 'src', 'app', '_api_android_backup');

function enforceJava17(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  const updated = content
    .replace(/JavaVersion\.VERSION_21/g, 'JavaVersion.VERSION_17')
    .replace(/sourceCompatibility\s*=\s*21/g, 'sourceCompatibility = 17')
    .replace(/targetCompatibility\s*=\s*21/g, 'targetCompatibility = 17');

  if (updated !== content) {
    fs.writeFileSync(filePath, updated, 'utf8');
    console.log(`Applied Java 17 compatibility: ${path.relative(root, filePath)}`);
  }
}

function run(cmd, args, envOverrides = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      cwd: root,
      env: { ...process.env, ...envOverrides },
    });

    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} failed with exit code ${code}`));
    });

    child.on('error', reject);
  });
}

async function main() {
  let moved = false;
  try {
    if (fs.existsSync(apiBackupDir)) {
      throw new Error('Backup API directory already exists: src/app/_api_android_backup');
    }

    if (fs.existsSync(apiDir)) {
      fs.renameSync(apiDir, apiBackupDir);
      moved = true;
      console.log('Temporarily moved src/app/api for Android static export build.');
    }

    await run('next', ['build'], { ANDROID_STATIC_EXPORT: '1' });
    await run('npx', ['cap', 'sync', 'android']);

    enforceJava17(path.join(root, 'android', 'app', 'capacitor.build.gradle'));
    enforceJava17(path.join(root, 'android', 'capacitor-cordova-android-plugins', 'build.gradle'));
    enforceJava17(path.join(root, 'node_modules', '@capacitor', 'app', 'android', 'build.gradle'));

    console.log('Android preparation completed successfully.');
  } finally {
    if (moved) {
      if (fs.existsSync(apiDir)) {
        throw new Error('Cannot restore API directory because src/app/api already exists.');
      }
      fs.renameSync(apiBackupDir, apiDir);
      console.log('Restored src/app/api after Android preparation.');
    }
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
