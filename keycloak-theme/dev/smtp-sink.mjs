// Minimal SMTP sink for local theme tests: accepts any mail and drops it (no relay, no storage).
// Usage: node dev/smtp-sink.mjs [port]   (default 2525)
import net from 'node:net';

const port = Number(process.argv[2] ?? 2525);
net
  .createServer((socket) => {
    let inData = false;
    socket.write('220 localhost sink\r\n');
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      for (const line of chunk.toString('utf8').split('\r\n')) {
        if (inData) {
          if (line === '.') {
            inData = false;
            socket.write('250 ok\r\n');
          }
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') socket.write('250 localhost\r\n');
        else if (cmd === 'DATA') {
          inData = true;
          socket.write('354 go\r\n');
        } else if (cmd === 'QUIT') socket.end('221 bye\r\n');
        else if (line) socket.write('250 ok\r\n');
      }
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`smtp sink on ${port}`));
