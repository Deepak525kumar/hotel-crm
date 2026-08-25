const fs = require('fs');
const file = 'mobile/worker-app/src/app/(auth)/login.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace("import { useRouter } from 'expo-router';", "import { useRouter, useLocalSearchParams } from 'expo-router';");
content = content.replace("const router = useRouter();", "const router = useRouter();\n  const params = useLocalSearchParams();");

const oldRedirect = "      router.replace('/(app)');";
const newRedirect = `      if (params.returnTo) {
        router.replace(params.returnTo as string);
      } else {
        router.replace('/(app)');
      }`;

content = content.replace(oldRedirect, newRedirect);

fs.writeFileSync(file, content);
