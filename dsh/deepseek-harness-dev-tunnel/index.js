const TUNNEL_ID = 'deepseek-harness-desktop'
const DESCRIPTION = 'Private access to DeepSeek Harness Desktop'
const PUBLIC_URL = 'https://35mm2rds-63694.asse.devtunnels.ms/'
const PWA_MANIFEST = JSON.stringify({
  id: '/',
  name: 'DeepSeek Harness',
  short_name: 'DSH',
  start_url: '/open',
  scope: '/',
  display: 'standalone',
  background_color: '#ffffff',
  theme_color: '#ffffff',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
})

export const inject = ['webServer', 'connection', 'subprocess']

function collected(handle) {
  return {
    stdout: handle.collected.stdout?.readFrom(0).text.trim() ?? '',
    stderr: handle.collected.stderr?.readFrom(0).text.trim() ?? '',
  }
}

export async function apply(ctx) {
  const executable = await ctx.subprocess.resolveExecutable('devtunnel')
  const origin = new URL(ctx.webServer.getOrigin())
  const port = origin.port
  if (!port) throw new Error(`The Harness web origin has no port: ${origin}`)

  const run = async argv => {
    const handle = ctx.subprocess.spawn({
      argv,
      cwd: process.cwd(),
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 64 * 1024 },
        stderr: { maxBytes: 64 * 1024 },
      },
      graceMs: 5000,
    })
    const outcome = await handle.done
    return { outcome, ...collected(handle) }
  }

  const existing = await run([executable, 'show', TUNNEL_ID, '--json'])
  if (existing.outcome.exitCode !== 0) {
    const created = await run([
      executable,
      'create',
      TUNNEL_ID,
      '--expiration',
      '30d',
      '--description',
      DESCRIPTION,
    ])
    if (created.outcome.exitCode !== 0) {
      throw new Error(`Could not create Dev Tunnel ${TUNNEL_ID}: ${created.stderr || created.stdout}`)
    }
  }

  const existingPort = await run([executable, 'port', 'show', TUNNEL_ID, '--port-number', port, '--json'])
  if (existingPort.outcome.exitCode !== 0) {
    const createdPort = await run([
      executable,
      'port',
      'create',
      TUNNEL_ID,
      '--port-number',
      port,
      '--protocol',
      origin.protocol.slice(0, -1),
      '--description',
      'DeepSeek Harness Desktop',
    ])
    if (createdPort.outcome.exitCode !== 0) {
      throw new Error(`Could not create Dev Tunnel port ${port}: ${createdPort.stderr || createdPort.stdout}`)
    }
  }

  const host = ctx.subprocess.spawn({
    argv: [executable, 'host', TUNNEL_ID, '--host-header', 'unchanged', '--origin-header', 'unchanged'],
    cwd: process.cwd(),
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 256 * 1024 },
      stderr: { maxBytes: 256 * 1024 },
    },
    graceMs: 5000,
  })

  const disposeOpenRoute = ctx.webServer.register({
    kind: 'exact',
    path: '/open',
    handler(request, response) {
      const authenticatedUrl = new URL(ctx.connection.authenticatedUrl(PUBLIC_URL))
      const requestUrl = request.url
      request.url = `/${authenticatedUrl.search}`
      try {
        ctx.connection.authorizeIndex(request, {
          writeHead(status, headers) {
            const cookie = headers?.['set-cookie']
            return response.writeHead(status, cookie === undefined ? headers : {
              ...headers,
              location: '/',
              'set-cookie': `${cookie.replace('SameSite=Strict', 'SameSite=None')}; Secure`,
            })
          },
          end(body) {
            return response.end(body)
          },
        })
      } finally {
        request.url = requestUrl
      }
    },
  })

  const disposeManifestRoute = ctx.webServer.register({
    kind: 'exact',
    path: '/dev-tunnel.webmanifest',
    async resource() {
      return new Response(PWA_MANIFEST, {
        headers: {
          'content-type': 'application/manifest+json',
          'cache-control': 'no-store',
        },
      })
    },
  })
  const disposeManifestTap = ctx.webServer.tapIndex(html =>
    html.replace('manifest.webmanifest', 'dev-tunnel.webmanifest'))

  let disposed = false
  host.done.then(outcome => {
    if (!disposed) {
      const output = collected(host)
      console.error(`[dev-tunnel] Host exited (${outcome.exitCode ?? outcome.signal}): ${output.stderr || output.stdout}`)
    }
  }, error => {
    if (!disposed) console.error('[dev-tunnel] Host failed:', error)
  })

  console.info(`[dev-tunnel] Hosting ${origin.origin} as ${TUNNEL_ID} (owner-only)`)
  console.info(`[dev-tunnel] Open ${ctx.connection.authenticatedUrl(PUBLIC_URL)}`)
  return async () => {
    disposed = true
    disposeManifestTap()
    disposeManifestRoute()
    disposeOpenRoute()
    host.terminate()
    await host.waitForExit()
  }
}
