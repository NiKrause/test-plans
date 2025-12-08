import { parseArgs } from 'node:util'
import fs from 'node:fs'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { perf } from '@libp2p/perf'
import { tcp } from '@libp2p/tcp'
import { webRTCDirect } from '@libp2p/webrtc'
import { multiaddr } from '@multiformats/multiaddr'
import { createLibp2p } from 'libp2p'

const argv = parseArgs({
  options: {
    'run-server': {
      type: 'string',
      default: 'false'
    },
    'server-address': {
      type: 'string'
    },
    transport: {
      type: 'string',
      default: 'tcp'
    },
    'upload-bytes': {
      type: 'string',
      default: '0'
    },
    'download-bytes': {
      type: 'string',
      default: '0'
    }
  }
})

/**
 * @param {boolean} runServer
 * @param {string} serverAddress
 * @param {string} transport
 * @param {number} uploadBytes
 * @param {number} downloadBytes
 */
export async function main (runServer, serverAddress, transport, uploadBytes, downloadBytes) {
  const config = {
    transports: [],
    streamMuxers: [
      yamux()
    ],
    connectionEncrypters: [
      noise()
    ],
    services: {
      perf: perf()
    }
  }

  // Configure transport based on flag
  if (transport === 'tcp') {
    config.transports.push(tcp())
  } else if (transport === 'webrtc-direct') {
    config.transports.push(webRTCDirect())
  } else {
    throw new Error(`Unsupported transport: ${transport}`)
  }

  if (runServer) {
    let listenAddr
    if (transport === 'tcp') {
      const { host, port } = splitHostPort(serverAddress)
      listenAddr = `/ip4/${host}/tcp/${port}`
    } else if (transport === 'webrtc-direct') {
      const { host, port } = splitHostPort(serverAddress)
      listenAddr = `/ip4/${host}/udp/${port}/webrtc-direct`
    }

    Object.assign(config, {
      addresses: {
        listen: [listenAddr]
      }
    })
  }

  const node = await createLibp2p(config)

  await node.start()

  if (runServer) {
    // Write all listen multiaddrs to file for runner to capture
    // Using file approach is more reliable than stderr redirection through perf wrapper
    for (const ma of node.getMultiaddrs()) {
      fs.appendFileSync('/tmp/webrtc-listen-addrs.txt', `[LISTEN_ADDR] ${ma.toString()}\n`)
      // eslint-disable-next-line no-console
      console.error(`[LISTEN_ADDR] ${ma.toString()}`)
    }
    // Keep server running
  } else {
    // Client mode: parse server address
    let targetAddr
    if (transport === 'tcp') {
      const { host, port } = splitHostPort(serverAddress)
      targetAddr = multiaddr(`/ip4/${host}/tcp/${port}`)
    } else if (transport === 'webrtc-direct') {
      // For WebRTC Direct, serverAddress should be the full multiaddr from server
      targetAddr = multiaddr(serverAddress)
    }

    for await (const output of node.services.perf.measurePerformance(targetAddr, uploadBytes, downloadBytes)) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(output))
    }

    await node.stop()
  }
}

/**
 * @param {string} address
 * @returns { host: string, port?: string }
 */
function splitHostPort (address) {
  try {
    const parts = address.split(':')
    const host = parts[0]
    const port = parts[1]
    return {
      host,
      port
    }
  } catch (error) {
    throw Error('Invalid server address')
  }
}

main(argv.values['run-server'] === 'true', argv.values['server-address'], argv.values.transport, Number(argv.values['upload-bytes']), Number(argv.values['download-bytes'])).catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})


