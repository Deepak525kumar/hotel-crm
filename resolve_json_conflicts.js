const fs = require('fs');
const { execSync } = require('child_process');

function isObject(item) {
  return (item && typeof item === 'object' && !Array.isArray(item));
}

function deepMerge(target, ...sources) {
  if (!sources.length) return target;
  const source = sources.shift();

  if (isObject(target) && isObject(source)) {
    for (const key in source) {
      if (isObject(source[key])) {
        if (!target[key]) Object.assign(target, { [key]: {} });
        deepMerge(target[key], source[key]);
      } else {
        Object.assign(target, { [key]: source[key] });
      }
    }
  }
  return deepMerge(target, ...sources);
}

const files = execSync('git diff --name-only --diff-filter=U | grep "\\.json$"', { encoding: 'utf8' }).trim().split('\n');

for (const file of files) {
  if (!file) continue;
  try {
    const oursStr = execSync(`git show :2:${file}`, { encoding: 'utf8' });
    const theirsStr = execSync(`git show :3:${file}`, { encoding: 'utf8' });
    
    const ours = JSON.parse(oursStr);
    const theirs = JSON.parse(theirsStr);
    
    const merged = deepMerge({}, theirs, ours); // Ours takes precedence if conflict
    
    fs.writeFileSync(file, JSON.stringify(merged, null, 2) + '\n');
    execSync(`git add ${file}`);
    console.log(`Resolved ${file}`);
  } catch (err) {
    console.error(`Failed to resolve ${file}`, err.message);
  }
}
