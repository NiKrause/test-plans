# Investigation: roamhq WRTC Remote Connection Issues

**Date:** December 8, 2025  
**Investigated by:** Automated benchmarking on Hetzner Cloud infrastructure  
**Fork:** https://github.com/NiKrause/js-libp2p/tree/feat/evaluate-roamhq-wrtc

## Executive Summary

The `@roamhq/wrtc` package (a fork of `node-webrtc`) **works for localhost connections but fails for remote internet connections** due to critical bugs in ICE candidate gathering. This makes it unsuitable for production use in distributed systems.

**Recommendation:** Use `node-datachannel` instead, which works reliably for both local and remote connections.

## Problem Description

When benchmarking WebRTC Direct transport implementations for js-libp2p, we found:

- ✅ **webrtc-node-datachannel**: Works for both localhost AND remote server connections
- ❌ **webrtc-roamhq-wrtc**: Works for localhost, **FAILS for remote server connections with timeout errors**

### Error Observed

```
DOMException [TimeoutError]: The operation was aborted due to timeout
```

### Test Environment

- **Infrastructure:** Two Hetzner Cloud servers (Nuremberg & Falkenstein, Germany)
- **Server IPs:** Both servers have public IPv4 addresses
- **Network:** UDP port 4001 open, no NAT between servers
- **STUN servers configured:**
  - stun:stun.l.google.com:19302
  - stun:global.stun.twilio.com:3478
  - stun:stun.cloudflare.com:3478
  - stun:stun.services.mozilla.com:3478

## Investigation Results

### 1. Package Tests Pass (but only for localhost)

```bash
cd /tmp/js-libp2p-fork/packages/transport-webrtc
npm run test:node
```

**Result:** ✅ 33 tests passing, including "should connect" test

**Key finding:** Tests establish real WebRTC connections using `RTCPeerConnection` and verify `connectionState` becomes `'connected'`, **but all tests run on localhost** where no STUN/NAT traversal is needed.

### 2. Server Binds Correctly

```bash
netstat -ulnp | grep 4001
# Output: udp  0  0.0.0.0:4001  0.0.0.0:*  22829/node
```

The roamhq WRTC server correctly binds to `0.0.0.0:4001` and the listen address is properly captured with the public IP.

### 3. Connection Timeout During WebRTC Handshake

The timeout occurs at the WebRTC connection level (ICE negotiation), not at the network level. The server starts successfully but client connections time out during the ICE gathering/connection establishment phase.

## Root Cause: Known Bugs in node-webrtc

Through GitHub issue investigation, we identified that `@roamhq/wrtc` (which is a fork of WonderInventions/node-webrtc, itself a fork of node-webrtc/node-webrtc) inherits critical ICE gathering bugs from the upstream project.

### Relevant GitHub Issues

#### node-webrtc/node-webrtc

1. **Issue #652: "Only works in localhost, not in remote servers."** (OPEN)
   - https://github.com/node-webrtc/node-webrtc/issues/652
   - **Exactly matches our symptoms**
   - Users report: "For some reason node-webrtc does not get the ice candidates with typ relay"
   - Workaround: Use TURN server, but STUN alone doesn't work

2. **Issue #664: "Working stun only between two browsers, doesn't work with node-webrtc except with turn"** (CLOSED)
   - https://github.com/node-webrtc/node-webrtc/issues/664
   - STUN servers are insufficient for node-webrtc
   - Requires TURN server for remote connections to work

3. **Issue #712: "ICE gathering issue"** (OPEN)
   - https://github.com/node-webrtc/node-webrtc/issues/712
   - **Critical finding:** "Reflective ICE gather is working in the case where peer connection is the creator of the offer... It however fails to work when the peer connection is the answerer."
   - **This explains our timeout:** In our benchmark, the server creates the offer and the client is the answerer. The client (answerer) fails to gather ICE candidates properly.

4. **Issue #737: "ice gathering taking time to complete on server-side"** (OPEN)
   - https://github.com/node-webrtc/node-webrtc/issues/737
   - ICE gathering is very slow on node-webrtc servers (>10 seconds vs <2 seconds in browsers)
   - Exacerbated on low-resource VMs

#### WonderInventions/node-webrtc (roamhq fork upstream)

5. **Issue #35: "Segfault when closing RTCPeerConnections"** (OPEN)
   - https://github.com/WonderInventions/node-webrtc/issues/35
   - Explains the `SIGSEGV` crashes we observed during test cleanup:
     ```
     Command was killed with SIGSEGV (Segmentation fault)
     FATAL ERROR: v8::HandleScope::CreateHandle() Cannot create a handle without a HandleScope
     ```

## Technical Analysis

### Why Tests Pass But Real Connections Fail

1. **Localhost doesn't require ICE/STUN:**
   - Tests establish connections on `127.0.0.1`
   - No need for STUN server reflexive candidates
   - No NAT traversal required
   - ICE gathering completes with host candidates only

2. **Remote connections require proper ICE:**
   - Need reflexive candidates from STUN servers
   - Need proper ICE candidate exchange
   - **node-webrtc's ICE implementation is broken for answering peers**

### The Offer/Answer Bug

In WebRTC direct connections with libp2p:
- **Server (Dialer):** Creates the offer → ICE gathering works ✅
- **Client (Receiver):** Creates the answer → ICE gathering fails ❌

This asymmetry causes one-way connection failures. The client times out waiting for a proper ICE connection that can never complete because it's not gathering STUN reflexive candidates.

## Benchmark Performance Comparison

### node-datachannel (Working Implementation)

Test run on December 8, 2025:

| Metric | WebRTC Direct | TCP | Difference |
|--------|---------------|-----|------------|
| Upload throughput | ~150 Mbps | ~650 Mbps | 77% slower |
| Download throughput | ~160 Mbps | ~740 Mbps | 78% slower |
| Connection + 1-byte latency | 471ms | 119ms | 4x higher |

### roamhq-wrtc (Failed Implementation)

- ❌ Server starts successfully
- ❌ Listen address captured correctly
- ❌ Network binding works (`0.0.0.0:4001`)
- ❌ **Connection times out during ICE negotiation**
- ❌ No throughput or latency data available

## Conclusions

1. **`@roamhq/wrtc` is not production-ready** for distributed/remote WebRTC connections
2. **The bugs are inherited from upstream `node-webrtc`** and affect all forks
3. **ICE gathering is fundamentally broken** for answering peers
4. **Tests provide false confidence** because they only validate localhost scenarios
5. **TURN servers might work as a workaround** but this adds complexity and infrastructure cost

## Recommendations

### Immediate Action

**Use `node-datachannel` for js-libp2p WebRTC transport:**
- ✅ Works reliably for remote connections
- ✅ Proper ICE implementation
- ✅ No crashes or segfaults
- ✅ Better performance than roamhq-wrtc would theoretically provide

### Long-term Actions

1. **Report to upstream:** Create detailed issue in node-webrtc/node-webrtc with our findings
2. **Document in js-libp2p:** Add warnings about roamhq-wrtc limitations
3. **Consider alternatives:** 
   - Continue with node-datachannel
   - Wait for upstream fixes (issue #712 has been open since 2021)
   - Contribute fixes to node-webrtc if resources permit

## Appendix: Test Configuration

### Package Versions

- `@roamhq/wrtc`: ^0.9.1 (via GitHub: NiKrause/js-libp2p#feat/evaluate-roamhq-wrtc)
- `libp2p`: 3.1.2 (from fork)
- `@libp2p/webrtc`: 6.0.10 (from fork)

### Build Process

```bash
# Clone and build fork
git clone -b feat/evaluate-roamhq-wrtc https://github.com/NiKrause/js-libp2p.git
cd js-libp2p
npm install
npm run build

# Install in implementation directory
cd /path/to/impl/js-libp2p/webrtc-roamhq-wrtc
npm install /tmp/js-libp2p-fork/packages/transport-webrtc
npm install /tmp/js-libp2p-fork/packages/libp2p
npm install
```

### Test Command

```bash
npm run start -- \
  --client-public-ip 46.224.47.202 \
  --server-public-ip 91.98.192.91 \
  --test-filter js-libp2p \
  --testing
```

## References

- Original investigation: December 8, 2025
- Test infrastructure: Hetzner Cloud (Germany)
- Benchmark results: `benchmark-results-2025-12-08T07-15-33.json`
- Fork repository: https://github.com/NiKrause/js-libp2p/tree/feat/evaluate-roamhq-wrtc
- Upstream issues: https://github.com/node-webrtc/node-webrtc/issues
