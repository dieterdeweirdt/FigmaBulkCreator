// Bundelt src/ + vendor/ naar dist/ (Figma laadt maar één HTML-bestand voor de UI).
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const inline = (file) => '<script>' + read(file).replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--') + '</script>';

const html = read('src/ui.html').replace('<!-- inject:vendor -->', () =>
  [inline('vendor/xlsx.full.min.js'), inline('vendor/fflate.min.js')].join('\n'));

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/ui.html'), html);
fs.copyFileSync(path.join(root, 'src/code.js'), path.join(root, 'dist/code.js'));
console.log('✓ dist/ui.html (' + Math.round(html.length / 1024) + ' kB) en dist/code.js');

if (process.argv.includes('--watch')) {
  let t;
  fs.watch(path.join(root, 'src'), () => {
    clearTimeout(t);
    t = setTimeout(() => require('child_process').spawnSync(process.execPath, [__filename], { stdio: 'inherit' }), 100);
  });
  console.log('… wacht op wijzigingen in src/');
}
