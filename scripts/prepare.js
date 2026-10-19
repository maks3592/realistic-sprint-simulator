const fs = require('fs');
const path = require('path');

const www = path.join(__dirname, '..', 'www');
const fontsDir = path.join(www, 'fonts');
fs.mkdirSync(fontsDir, { recursive: true });

fs.copyFileSync(
  path.join(__dirname, '..', 'node_modules', 'three', 'build', 'three.min.js'),
  path.join(www, 'three.min.js')
);

const wanted = {
  'exo-2': [700, 800].flatMap(w => [`exo-2-cyrillic-${w}-normal.woff2`, `exo-2-latin-${w}-normal.woff2`]),
  manrope: [500, 600, 700].flatMap(w => [`manrope-cyrillic-${w}-normal.woff2`, `manrope-latin-${w}-normal.woff2`]),
  'jetbrains-mono': ['jetbrains-mono-cyrillic-400-normal.woff2', 'jetbrains-mono-latin-400-normal.woff2']
};

for (const [pkg, files] of Object.entries(wanted)) {
  for (const file of files) {
    fs.copyFileSync(
      path.join(__dirname, '..', 'node_modules', '@fontsource', pkg, 'files', file),
      path.join(fontsDir, file)
    );
  }
}
