/**
 * Test orchestrator: starts the Daraja stand-in and a production `next start`
 * wired to it, runs the integration and/or browser suites, then shuts down.
 *   node tests/run.mjs [--only=integration|e2e]
 * Requires `npm run build` first and a migrated, seeded database.
 */
import { spawn, execSync } from "node:child_process";
import { startMockDaraja, TEST_CREDENTIALS } from "./mock-daraja.mjs";

const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];
const APP_PORT = 3100;
const MOCK_PORT = 4010;
const env = {
  ...process.env,
  PORT: String(APP_PORT),
  MPESA_ENVIRONMENT: "sandbox",
  MPESA_CONSUMER_KEY: TEST_CREDENTIALS.key,
  MPESA_CONSUMER_SECRET: TEST_CREDENTIALS.secret,
  MPESA_PASSKEY: TEST_CREDENTIALS.passkey,
  MPESA_SHORTCODE: TEST_CREDENTIALS.shortcode,
  MPESA_API_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
  MPESA_CALLBACK_URL: `http://127.0.0.1:${APP_PORT}`,
  TEST_APP_URL: `http://localhost:${APP_PORT}`,
};

const mock = await startMockDaraja(MOCK_PORT);
console.log(`▶ mock Daraja on :${MOCK_PORT}`);
const app = spawn("npx", ["next", "start", "-p", String(APP_PORT)], { env, shell: true, stdio: ["ignore", "pipe", "pipe"] });
let appLog = "";
app.stdout.on("data", (d) => (appLog += d));
app.stderr.on("data", (d) => (appLog += d));

async function waitForApp() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${APP_PORT}/robots.txt`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`App did not start:\n${appLog}`);
}

function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env, shell: true, stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

let code = 0;
try {
  await waitForApp();
  console.log(`▶ app on :${APP_PORT}`);
  if (!only || only === "integration") code ||= await run("node", ["--import", "tsx", "--conditions=react-server", "--test", "--test-concurrency=1", "tests/integration.test.ts"]);
  if (!only || only === "e2e") code ||= await run("node", ["--import", "tsx", "--test", "--test-concurrency=1", "tests/e2e.test.ts"]);
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  if (process.platform === "win32") {
    try { execSync(`taskkill /pid ${app.pid} /T /F`, { stdio: "ignore" }); } catch {}
  } else app.kill("SIGTERM");
  await mock.close();
  if (code) console.log(`\n── app log (tail) ──\n${appLog.split("\n").slice(-40).join("\n")}`);
}
process.exit(code);
