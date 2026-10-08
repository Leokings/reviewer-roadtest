import { Sandbox } from "@vercel/sandbox";

const sandbox = await Sandbox.create({
  timeout: 600000,
  resources: { vcpus: 1 },
  persistent: false,
  env: { PLAYWRIGHT_BROWSERS_PATH: "/vercel/ms-playwright" }
});
let snapshotted = false;
try {
  await sandbox.writeFiles([{
    path: "package.json",
    content: Buffer.from(JSON.stringify({ private: true, type: "module", dependencies: { playwright: "1.64.0" } }))
  }]);
  for (const [cmd, args, sudo] of [
    ["npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], false],
    ["npx", ["playwright", "install", "--with-deps", "chromium"], true],
    ["node", ["--input-type=module", "-e", "import { chromium } from 'playwright'; const b=await chromium.launch({headless:true,args:['--no-sandbox']}); await b.close(); console.log('browser-ready')"], false]
  ]) {
    const result = await sandbox.runCommand({ cmd, args, sudo, cwd: "/vercel" });
    const output = ((await result.stdout()) + (await result.stderr())).trim();
    console.log(cmd, result.exitCode, output.slice(-500));
    if (result.exitCode !== 0) throw new Error(`${cmd} failed`);
  }
  const snapshot = await sandbox.snapshot({ expiration: 0 });
  snapshotted = true;
  console.log(`ROADTEST_SANDBOX_SNAPSHOT_ID=${snapshot.snapshotId}`);
} finally {
  if (!snapshotted) await sandbox.stop();
}
