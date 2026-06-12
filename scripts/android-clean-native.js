const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const paths = [
  'android/app/.cxx',
  'android/app/build',
  'android/build',
  path.join(
    'node_modules',
    '@offline-protocol',
    'mesh-sdk',
    'android',
    'build',
  ),
];

for (const relativePath of paths) {
  const target = path.join(root, relativePath);
  fs.rmSync(target, { recursive: true, force: true });
  console.log('removed', relativePath);
}

console.log('Native Android build caches cleared.');
