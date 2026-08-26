# Hotel CRM — Checker app

The Expo (React Native) app for the CHECKER role: the attendance queue, quality
inspections and rework, absences, and the checker's own onboarding/HR screens.

Sibling app: `../worker-app` (WORKER role). The two share a backend and a good
deal of ported code, but they are separate apps with distinct bundle IDs
(`com.hotelcrm.checkerapp`), URL schemes (`checkerapp`), push topics, and — see
below — dev-server ports. Only the roles in `ALLOWED_ROLES`
(`src/constants/app-config.ts`) can hold a session here; the gate is enforced in
`src/stores/auth-store.ts`.

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npm start
   ```

   Use `npm start` / `npm run ios` / `npm run android` rather than `npx expo start`
   directly — see "Dev server port" below.

## Dev server port

**This app's dev server is pinned to port 8082** (`--port 8082` in every `start`,
`ios`, `android` and `web` script). worker-app keeps Expo's default 8081. Do not
remove these flags.

Both apps are Expo projects in the same repo, and Expo's default dev-server port
is 8081 for both. When 8081 is already taken by worker-app's server, `expo
run:ios` calls `resolvePortAsync(..., { reuseExistingPort: true })` and offers
"Use port 8082 instead?". Decline it — or run non-interactively, where the CLI
warns and takes the same branch — and it skips starting a dev server at all,
falling back to `options.port ?? 8081` (`@expo/cli`,
`src/run/resolveBundlerProps.ts`). The checker app is then built pointing at
8081, which is worker-app's Metro: you get a build of this app serving the other
app's JavaScript bundle. The two apps look similar enough that this is easy to
miss.

Passing the port explicitly closes both halves: the collision never happens, and
if 8082 is ever busy too, that same fallback resolves to 8082 rather than 8081 —
so a checker build can no longer silently attach to worker-app's server.

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
