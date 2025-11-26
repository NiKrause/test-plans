# WebRTC Performance Testing Implementation

## Summary

This document describes the implementation of WebRTC Direct performance testing for libp2p/test-plans to validate PR #3356 (@roamhq/wrtc replacement).

## What Was Built

### 1. New Implementation: `webrtc-roamhq-wrtc`

**Location:** `/Users/nandi/test-plans/perf/impl/js-libp2p/webrtc-roamhq-wrtc/`

**Purpose:** Test WebRTC Direct transport using your PR #3356 which replaces node-datachannel with @roamhq/wrtc + stun.

**Key Features:**
- Uses local build of your js-libp2p fork at `/Users/nandi/js-libp2p`
- Dependencies point to local packages:
  - `libp2p`: `file:/Users/nandi/js-libp2p/packages/libp2p` (v3.1.2)
  - `@libp2p/webrtc`: `file:/Users/nandi/js-libp2p/packages/transport-webrtc` (v6.0.10)
- Updated versions:
  - `@chainsafe/libp2p-noise`: v17.0.0
  - `@chainsafe/libp2p-yamux`: v7.0.4
  - `@multiformats/multiaddr`: v13.0.1

**Transport Support:**
- ✅ WebRTC Direct (webrtc-direct)
- ✅ Prints full multiaddr with certhash and peer ID to stderr
- ✅ Client parses full multiaddr from `--server-address`

### 2. Runner Modifications

**File:** `/Users/nandi/test-plans/perf/runner/src/index.ts`

**Changes Made:**
1. Added `getWebRTCDirectListenAddr()` function to extract multiaddr from server logs
2. Modified `runBenchmarkAcrossVersions()` to:
   - Wait 2 seconds after server start for WebRTC Direct
   - Capture listen address from server log
   - Pass it to client
3. Updated `runClient()` to use captured multiaddr for webrtc-direct transport
4. Updated `ArgsRunBenchmark` interface with `serverListenAddr` field

**File:** `/Users/nandi/test-plans/perf/runner/versionsInput.json`

Added new version entry:
```json
{
  "id": "webrtc-roamhq-wrtc",
  "implementation": "js-libp2p",
  "transportStacks": ["webrtc-direct"]
}
```

### 3. Implementation Files Modified

**index.js** - Both variants updated to:
- Support `--transport` flag (tcp, webrtc-direct)
- Print `[LISTEN_ADDR] <multiaddr>` to stderr on server startup
- Parse full multiaddr from `--server-address` for WebRTC Direct
- Maintain stdout exclusively for JSON perf measurements

**package.json** - Updated dependencies to match PR versions

## How It Works

### Server Flow
1. Server starts with `--run-server --server-address 0.0.0.0:4001 --transport webrtc-direct`
2. libp2p binds to UDP port 4001 with WebRTC Direct
3. Server prints to stderr: `[LISTEN_ADDR] /ip4/0.0.0.0/udp/4001/webrtc-direct/certhash/uEi.../p2p/12D3...`
4. Server keeps running, waiting for connections

### Client Flow
1. Runner extracts listen multiaddr from server.log
2. Client receives full multiaddr: `/ip4/<server-ip>/udp/4001/webrtc-direct/certhash/.../p2p/...`
3. Client dials server using this multiaddr
4. Perf measurements stream to stdout as JSON

### Data Flow
```
Server (stderr) → server.log → Runner (grep) → Client (--server-address)
Server/Client (stdout) → JSON metrics → Runner → benchmark-results.json
```

## Running Performance Tests

### Prerequisites
1. AWS credentials configured
2. Terraform 1.5.4+
3. Node.js 18+
4. SSH key pair (or run `make ssh-keygen` in terraform directory)

### Step 1: Provision Infrastructure

```bash
cd /Users/nandi/test-plans/perf/terraform/configs/local

# Generate SSH keys if needed
make ssh-keygen
make ssh-add

# Provision AWS EC2 instances
terraform init
terraform apply

# Capture instance IPs
export CLIENT_IP=$(terraform output -raw client_ip)
export SERVER_IP=$(terraform output -raw server_ip)
```

### Step 2: Build Implementation

The runner automatically builds implementations, but you can test manually:

```bash
cd /Users/nandi/test-plans/perf/impl/js-libp2p/webrtc-roamhq-wrtc
npm install  # Already done locally
```

### Step 3: Run Performance Tests

```bash
cd /Users/nandi/test-plans/perf/runner

# Install runner dependencies
npm ci

# Run tests (10 iterations, ~20 seconds per test)
npm run start -- \
  --client-public-ip $CLIENT_IP \
  --server-public-ip $SERVER_IP \
  --test-filter js-libp2p

# Or run in testing mode (1 iteration, 5 seconds per test)
npm run start -- \
  --client-public-ip $CLIENT_IP \
  --server-public-ip $SERVER_IP \
  --test-filter js-libp2p \
  --testing
```

### Step 4: Collect Results

Results are saved to: `/Users/nandi/test-plans/perf/runner/benchmark-results.json`

### Step 5: Cleanup

```bash
cd /Users/nandi/test-plans/perf/terraform/configs/local
terraform destroy
```

## Test Outputs

### Benchmarks Run
1. **throughput/upload** - Upload speed (bit/s)
2. **throughput/download** - Download speed (bit/s)
3. **Connection establishment + 1 byte round trip latencies** - Latency (s)

### Expected Results Format

```json
{
  "benchmarks": [
    {
      "name": "throughput/upload",
      "unit": "bit/s",
      "results": [
        {
          "implementation": "js-libp2p",
          "version": "webrtc-roamhq-wrtc",
          "transportStack": "webrtc-direct",
          "result": [
            {"type": "intermediary", "timeSeconds": 1.0, "uploadBytes": 12500000, "downloadBytes": 0},
            ...
          ]
        }
      ]
    }
  ]
}
```

## Known Issues

### @roamhq/wrtc Segfault
- **Status:** Known issue with @roamhq/wrtc
- **Impact:** Segmentation fault during process cleanup (after tests complete)
- **Workaround:** Does not affect test execution or measurements
- **Tests Passing:** All 33 functional tests pass before cleanup

### Local vs Remote Build
- **Important:** The implementation uses local file references to your PR
- **For CI/CD:** Replace file references with commit hash:
  ```json
  "@libp2p/webrtc": "github:NiKrause/js-libp2p#bb4ee1749814d0a9bdf44e2b9fcacf3ec6ad71dd"
  ```

## Troubleshooting

### Server doesn't print listen address
- Check: `ssh ec2-user@$SERVER_IP 'cat server.log'`
- Expected: Should see `[LISTEN_ADDR] /ip4/...`

### Client fails with "NoValidAddressesError"
- Cause: Runner didn't capture listen address correctly
- Fix: Check server.log exists and contains LISTEN_ADDR line

### Build failures on EC2
- Cause: Missing Node.js or npm on EC2 instances
- Fix: Ensure EC2 instances have Node.js 18+ (usually pre-configured in terraform)

### Dependencies not found
- Cause: Local js-libp2p not built
- Fix: `cd /Users/nandi/js-libp2p && npm run build`

## Next Steps

1. ✅ **Implementation Complete** - All code ready
2. 🔄 **Run Tests** - Execute performance suite on AWS
3. 📊 **Analyze Results** - Compare throughput metrics
4. 📝 **Report Findings** - Post to issues #3033 and PR #3356

### Analysis Checklist
- [ ] Upload throughput (bit/s)
- [ ] Download throughput (bit/s)  
- [ ] Connection latency (s)
- [ ] Stability (any crashes beyond known segfault?)
- [ ] Memory usage patterns
- [ ] Comparison with baseline (if node-datachannel variant tested)

### Reporting Template

Post to **Issue #3033** and **PR #3356**:

```markdown
## WebRTC Direct Performance Results

### Test Environment
- Implementation: webrtc-roamhq-wrtc (PR #3356)
- Transport: WebRTC Direct
- Iterations: 10
- Duration: 20 seconds per test

### Results

#### Upload Throughput
- Mean: X Mbit/s
- Median: X Mbit/s
- Std Dev: X Mbit/s

#### Download Throughput
- Mean: X Mbit/s
- Median: X Mbit/s
- Std Dev: X Mbit/s

#### Connection Latency
- Mean: X ms
- Median: X ms
- P95: X ms

### Observations
- [Stability notes]
- [Performance observations]
- [Comparison with node-datachannel if available]

### Dashboard
[Link to Observable dashboard visualization]

### Recommendation
[Proceed with @roamhq/wrtc / Keep node-datachannel / Further testing needed]
```

## Files Modified

### Created
- `/Users/nandi/test-plans/perf/impl/js-libp2p/webrtc-roamhq-wrtc/` (entire directory)

### Modified
- `/Users/nandi/test-plans/perf/runner/src/index.ts`
- `/Users/nandi/test-plans/perf/runner/versionsInput.json`

### External Dependencies
- `/Users/nandi/js-libp2p/` (PR #3356 local build)

## References

- **Issue #3033:** WebRTC streaming performance
- **Issue #3034:** Evaluate @roamhq/wrtc vs node-datachannel
- **PR #3356:** Implementation using @roamhq/wrtc
- **Test Plans Repo:** https://github.com/libp2p/test-plans
- **Dashboard:** https://observablehq.com/@libp2p-workspace/performance-dashboard
