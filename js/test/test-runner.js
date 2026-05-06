const { LinRedisServer } = require('../src/server');
const Redis = require('ioredis');
const path = require('path');
const fs = require('fs');

const PORT = 16389;
const HOST = '127.0.0.1';
const REPORT_DIR = path.join(__dirname, '..', '..', 'test-reports');

let server;
let redis;

async function startServer() {
  server = new LinRedisServer({ port: PORT, host: HOST });
  await server.start();
}

async function stopServer() {
  if (redis) { redis.disconnect(); redis = null; }
  if (server) { await server.stop(); server = null; }
}

function getRedis() {
  if (!redis) {
    redis = new Redis({ port: PORT, host: HOST, lazyConnect: true, retryStrategy: () => null });
  }
  return redis;
}

async function connectRedis() {
  const r = getRedis();
  await r.connect();
  return r;
}

async function runSuite(name, tests) {
  const cases = [];
  const startTime = Date.now();

  for (const test of tests) {
    const caseResult = { command: test.name, status: 'PASS', duration_ms: 0, message: '' };
    const t0 = Date.now();
    try {
      await test.fn();
      caseResult.duration_ms = Date.now() - t0;
    } catch (err) {
      caseResult.status = 'FAIL';
      caseResult.duration_ms = Date.now() - t0;
      caseResult.message = err.message;
    }
    cases.push(caseResult);
  }

  const passed = cases.filter(c => c.status === 'PASS').length;
  const failed = cases.filter(c => c.status === 'FAIL').length;

  return {
    name,
    passed,
    failed,
    duration_ms: Date.now() - startTime,
    cases,
  };
}

async function main() {
  console.log('=== lin-redis (JS) Test Runner ===\n');

  await startServer();
  console.log('Server started on port', PORT);

  const r = await connectRedis();
  console.log('Redis client connected\n');

  // Load test suites
  const stringSuite = require('./suites/string.test');
  const hashSuite = require('./suites/hash.test');
  const listSuite = require('./suites/list.test');
  const setSuite = require('./suites/set.test');
  const zsetSuite = require('./suites/zset.test');
  const serverSuite = require('./suites/server.test');

  const allSuites = [stringSuite, hashSuite, listSuite, setSuite, zsetSuite, serverSuite];
  const results = [];

  for (const suite of allSuites) {
    const result = await runSuite(suite.name, suite.tests(r));
    results.push(result);
    const icon = result.failed === 0 ? 'PASS' : 'FAIL';
    console.log(`  [${icon}] ${result.name}: ${result.passed}/${result.passed + result.failed} passed (${result.duration_ms}ms)`);
  }

  const totalPassed = results.reduce((s, r) => s + r.passed, 0);
  const totalFailed = results.reduce((s, r) => s + r.failed, 0);
  const totalCases = totalPassed + totalFailed;

  console.log(`\n=== Summary: ${totalPassed}/${totalCases} passed, ${totalFailed} failed ===\n`);

  const report = {
    timestamp: new Date().toISOString(),
    version: 'js',
    summary: {
      total: totalCases,
      passed: totalPassed,
      failed: totalFailed,
      skipped: 0,
    },
    suites: results,
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, 'js-report.json'), JSON.stringify(report, null, 2));

  let txt = `lin-redis (JS) Test Report\n`;
  txt += `==========================\n`;
  txt += `Timestamp: ${report.timestamp}\n\n`;
  for (const suite of results) {
    const sIcon = suite.failed === 0 ? 'PASS' : 'FAIL';
    txt += `[${sIcon}] Suite: ${suite.name}\n`;
    for (const c of suite.cases) {
      const icon = c.status === 'PASS' ? 'OK' : 'XX';
      txt += `  [${icon}] ${c.command} (${c.duration_ms}ms)`;
      if (c.message) txt += ` - ${c.message}`;
      txt += '\n';
    }
    txt += '\n';
  }
  txt += `Total: ${totalPassed}/${totalCases} passed, ${totalFailed} failed\n`;
  fs.writeFileSync(path.join(REPORT_DIR, 'js-report.txt'), txt);

  console.log(`Reports saved to ${REPORT_DIR}/js-report.{json,txt}`);

  await stopServer();
  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('Test runner error:', err);
  await stopServer();
  process.exit(1);
});
