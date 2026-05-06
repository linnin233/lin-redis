const { LinRedisServer } = require('./server');

let PORT = parseInt(process.env.LIN_REDIS_PORT || '6389');
let HOST = process.env.LIN_REDIS_HOST || '127.0.0.1';
let PASSWORD = process.env.LIN_REDIS_PASSWORD || '';

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--port' && i + 1 < process.argv.length) PORT = parseInt(process.argv[++i]);
  else if (arg === '--host' && i + 1 < process.argv.length) HOST = process.argv[++i];
  else if (arg === '--password' && i + 1 < process.argv.length) PASSWORD = process.argv[++i];
  else if (/^\d+$/.test(arg)) PORT = parseInt(arg);
}

async function main() {
  const server = new LinRedisServer({ port: PORT, host: HOST, password: PASSWORD });
  await server.start();
  console.log(`lin-redis (JS) listening on ${HOST}:${PORT}`);
  console.log(`  Commands registered: ${server.getStats().cmdCount}`);
  if (PASSWORD) console.log(`  Auth: enabled (password: ${PASSWORD})`);

  const shutdown = async () => {
    console.log('\nShutting down...');
    await server.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('Failed to start lin-redis:', err);
  process.exit(1);
});
