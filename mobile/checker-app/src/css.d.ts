// Ambient declarations for Expo's web CSS support.
//
// Metro resolves these imports at build time; TypeScript needs to be told
// they exist. Without this, `import '@/global.css'` (constants/theme.ts) and
// `import classes from './animated-icon.module.css'` (animated-icon.web.tsx)
// are TS2882/TS2307 errors.
//
// These never surfaced before because tsconfig.test.json's include listed
// no .tsx pattern and no src/components — the files were simply not
// compiled. They appear now that the include covers src/**.

// Side-effect stylesheet import: `import '@/global.css'`.
declare module '*.css';

// CSS Modules: `import classes from './x.module.css'` — a class-name map.
declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
