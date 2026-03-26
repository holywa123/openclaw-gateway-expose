const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// 配置
const CERT_PATH = process.env.OPENCLAW_CERT_PATH || 'C:\\Users\\Administrator\\openclaw.pfx';
const CERT_PASSPHRASE = process.env.OPENCLAW_CERT_PASS || 'openclaw123';
const PROXY_PORT = parseInt(process.env.OPENCLAW_PROXY_PORT) || 8443;
const TARGET_HOST = process.env.OPENCLAW_TARGET_HOST || '127.0.0.1';
const TARGET_PORT = parseInt(process.env.OPENCLAW_TARGET_PORT) || 28789;

// 检查证书文件
if (!fs.existsSync(CERT_PATH)) {
  console.error(`Error: Certificate file not found at ${CERT_PATH}`);
  console.error('Please generate a self-signed certificate first:');
  console.error('  $cert = New-SelfSignedCertificate -DnsName "openclaw.local" -CertStoreLocation cert:\\LocalMachine\\My');
  console.error('  Export-PfxCertificate -Cert $cert -FilePath "C:\\Users\\Administrator\\openclaw.pfx" -Password (ConvertTo-SecureString -String "openclaw123" -Force -AsPlainText)');
  process.exit(1);
}

const options = {
  pfx: fs.readFileSync(CERT_PATH),
  passphrase: CERT_PASSPHRASE
};

const server = https.createServer(options);

// 处理常规 HTTP 请求
server.on('request', (req, res) => {
  console.log(`[HTTP] ${req.method} ${req.url}`);
  
  const proxyOptions = {
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: `${TARGET_HOST}:${TARGET_PORT}`
    }
  };

  const proxy = http.request(proxyOptions, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxy.on('error', (err) => {
    console.error('[HTTP] Proxy error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502);
      res.end('Bad Gateway');
    }
  });

  req.pipe(proxy);
});

// 处理 WebSocket 升级
server.on('upgrade', (req, socket, head) => {
  console.log(`[WS] Upgrade request: ${req.url}`);
  
  const proxyOptions = {
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: `${TARGET_HOST}:${TARGET_PORT}`
    }
  };

  const proxyReq = http.request(proxyOptions);
  
  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    console.log('[WS] Got upgrade response from target');
    
    // 构建 101 响应
    let responseHeaders = 'HTTP/1.1 101 Switching Protocols\r\n';
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      responseHeaders += `${key}: ${value}\r\n`;
    }
    responseHeaders += '\r\n';
    
    socket.write(responseHeaders);
    
    if (proxyHead && proxyHead.length) {
      socket.write(proxyHead);
    }
    if (head && head.length) {
      proxySocket.write(head);
    }
    
    // 双向管道
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
    
    proxySocket.on('error', (err) => {
      console.error('[WS] Proxy socket error:', err.message);
      socket.destroy();
    });
    
    socket.on('error', (err) => {
      console.error('[WS] Client socket error:', err.message);
      proxySocket.destroy();
    });
    
    proxySocket.on('close', () => {
      console.log('[WS] Proxy socket closed');
    });
    
    socket.on('close', () => {
      console.log('[WS] Client socket closed');
    });
  });

  proxyReq.on('error', (err) => {
    console.error('[WS] Proxy request error:', err.message);
    socket.destroy();
  });

  proxyReq.end();
});

server.on('error', (err) => {
  console.error('[Server] Error:', err.message);
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PROXY_PORT} is already in use. Please stop the existing process or choose a different port.`);
  }
});

server.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log('='.repeat(60));
  console.log('OpenClaw Gateway HTTPS Proxy');
  console.log('='.repeat(60));
  console.log(`Listening: https://0.0.0.0:${PROXY_PORT}`);
  console.log(`Proxying to: http://${TARGET_HOST}:${TARGET_PORT}`);
  console.log(`Certificate: ${CERT_PATH}`);
  console.log('='.repeat(60));
  console.log('Press Ctrl+C to stop');
});
