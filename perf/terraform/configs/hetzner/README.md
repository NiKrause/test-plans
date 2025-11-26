# Hetzner Cloud Setup for libp2p Performance Testing

This Terraform configuration provisions two Ubuntu 22.04 servers in Germany (Hetzner Cloud) for running libp2p performance tests.

## Prerequisites

1. **Hetzner Cloud Account**
   - Sign up at https://console.hetzner.cloud/
   - Create a new project (e.g., "libp2p-perf")

2. **Hetzner API Token**
   - In Hetzner Cloud Console, go to your project
   - Navigate to "Security" → "API Tokens"
   - Generate a new token with "Read & Write" permissions
   - Save the token securely

3. **Terraform**
   - Install Terraform 1.5.4 or later
   - macOS: `brew install terraform`

4. **SSH Key**
   - Generate if needed: `cd ../../ && make ssh-keygen`
   - This creates `modules/short_lived/files/perf` and `perf.pub`

## Cost Estimation

- **Server type:** CX22 (2 vCPU, 4GB RAM)
- **Cost:** ~€5.50/month per server (~€0.008/hour)
- **Total for 2 servers:** ~€11/month (~€0.016/hour)
- **Typical test run:** ~30 minutes = **~€0.50**

Much cheaper than AWS! 🎉

## Setup Steps

### 1. Set Your Hetzner API Token

```bash
export HCLOUD_TOKEN="your-hetzner-api-token-here"
```

**Important:** Keep this token secret! Add it to your `~/.zshrc` or `~/.bashrc` for persistence:

```bash
echo 'export HCLOUD_TOKEN="your-token"' >> ~/.zshrc
source ~/.zshrc
```

### 2. Generate SSH Keys (if not already done)

```bash
cd /Users/nandi/test-plans/perf/terraform
make ssh-keygen
make ssh-add
```

### 3. Initialize Terraform

```bash
cd /Users/nandi/test-plans/perf/terraform/configs/hetzner
terraform init
```

### 4. Preview Changes

```bash
terraform plan
```

This shows what will be created:
- 2 servers (client and server)
- 1 SSH key
- 1 firewall with rules
- 1 firewall attachment

### 5. Create Infrastructure

```bash
terraform apply
```

Type `yes` when prompted. This takes ~60 seconds.

### 6. Capture Instance IPs

```bash
export SERVER_IP=$(terraform output -raw server_ip)
export CLIENT_IP=$(terraform output -raw client_ip)

echo "Server IP: $SERVER_IP"
echo "Client IP: $CLIENT_IP"
```

### 7. Wait for Servers to Initialize

The servers need ~2-3 minutes to:
- Install Node.js 22
- Install dependencies
- Complete cloud-init

```bash
# Wait and check
sleep 180

# Verify Node.js installation
ssh -o StrictHostKeyChecking=no ubuntu@$SERVER_IP 'node --version'
ssh -o StrictHostKeyChecking=no ubuntu@$CLIENT_IP 'node --version'
```

Expected output: `v22.x.x`

### 8. Run Performance Tests

```bash
cd /Users/nandi/test-plans/perf/runner

# Install runner dependencies (if not done)
npm ci

# Run tests
npm run start -- \
  --client-public-ip $CLIENT_IP \
  --server-public-ip $SERVER_IP \
  --test-filter js-libp2p \
  --testing
```

### 9. Collect Results

```bash
cat benchmark-results.json
```

### 10. Destroy Infrastructure

**Important:** Don't forget to destroy to avoid charges!

```bash
cd /Users/nandi/test-plans/perf/terraform/configs/hetzner
terraform destroy
```

Type `yes` to confirm.

## Configuration Details

### Server Locations
- **Server:** Nuremberg (nbg1) - Primary Hetzner datacenter
- **Client:** Falkenstein (fsn1) - Secondary datacenter
- **Distance:** ~300km between datacenters (realistic network latency)

### Server Specifications
- **Type:** CX22
- **vCPUs:** 2 AMD cores
- **RAM:** 4GB
- **Disk:** 40GB SSD
- **Network:** 20TB traffic included
- **OS:** Ubuntu 22.04 LTS

### Firewall Rules
- **SSH (TCP 22):** Open to all
- **Perf TCP (4001):** Open to all
- **Perf UDP (4001):** Open to all (for WebRTC)
- **iperf3 (TCP 5201):** Open to all
- **ICMP:** Open to all (for ping)

### User Account
- **Username:** `ubuntu` (not `ec2-user` like AWS)
- **Home directory:** `/home/ubuntu`

## Runner Modifications Needed

The runner currently uses `ec2-user` for SSH. You need to update it to use `ubuntu`:

### Option 1: Update Runner Code (Recommended)

Edit `/Users/nandi/test-plans/perf/runner/src/index.ts`:

```typescript
// Find all occurrences of 'ec2-user@' and replace with 'ubuntu@'
// Example (lines 71, 90, 94, 98, etc.):
const cmd = `ssh -o StrictHostKeyChecking=no ubuntu@${clientPublicIP} ...`
```

### Option 2: Quick Fix with sed

```bash
cd /Users/nandi/test-plans/perf/runner/src
sed -i.bak 's/ec2-user@/ubuntu@/g' index.ts
npm run build  # Rebuild TypeScript
```

## Troubleshooting

### "Permission denied (publickey)"
- Ensure SSH key is in ssh-agent: `ssh-add ~/.ssh/perf`
- Check key is uploaded: `terraform state show hcloud_ssh_key.perf`

### "No HCLOUD_TOKEN provided"
- Set the environment variable: `export HCLOUD_TOKEN="..."`
- Verify: `echo $HCLOUD_TOKEN`

### Servers not ready
- Wait longer (up to 5 minutes for cloud-init)
- Check cloud-init logs: `ssh ubuntu@$SERVER_IP 'tail -f /var/log/cloud-init-output.log'`

### Node.js not found
- Cloud-init may still be running
- Check setup log: `ssh ubuntu@$SERVER_IP 'cat /home/ubuntu/setup.log'`

### Firewall blocking connections
- Verify firewall: `terraform state show hcloud_firewall.perf_server`
- Check if attached: `terraform state show hcloud_firewall_attachment.perf_server`

## Alternative Server Locations

You can change the datacenter locations in `terraform.tf`:

### Available Hetzner Locations
- `fsn1` - Falkenstein, Germany
- `nbg1` - Nuremberg, Germany
- `hel1` - Helsinki, Finland
- `ash` - Ashburn, Virginia, USA
- `hil` - Hillsboro, Oregon, USA

### Example: USA Testing

```hcl
resource "hcloud_server" "server" {
  # ...
  location    = "ash"  # Virginia, USA
}

resource "hcloud_server" "client" {
  # ...
  location    = "hil"  # Oregon, USA
}
```

## Alternative Server Types

For different performance characteristics:

```hcl
# Smaller (cheaper): CX12 - 1 vCPU, 2GB RAM, ~€4/month
server_type = "cx12"

# Current: CX22 - 2 vCPU, 4GB RAM, ~€5.50/month
server_type = "cx22"

# Larger: CX32 - 4 vCPU, 8GB RAM, ~€11/month
server_type = "cx32"

# Even larger: CX42 - 8 vCPU, 16GB RAM, ~€22/month
server_type = "cx42"
```

## Advantages of Hetzner vs AWS

✅ **Cost:** ~70% cheaper than AWS
✅ **Privacy:** German data protection laws (GDPR)
✅ **Performance:** Excellent network quality in Europe
✅ **Simplicity:** No VPCs, security groups complexity
✅ **Transparency:** Clear, simple pricing

## Useful Commands

```bash
# SSH to server
ssh ubuntu@$SERVER_IP

# SSH to client
ssh ubuntu@$CLIENT_IP

# Check server status
ssh ubuntu@$SERVER_IP 'uptime && free -h && df -h'

# View Hetzner dashboard
open https://console.hetzner.cloud/

# Check Terraform state
terraform show

# List all resources
terraform state list

# Destroy specific resource
terraform destroy -target=hcloud_server.client
```

## Security Notes

1. **API Token:** Keep your `HCLOUD_TOKEN` secret
2. **SSH Key:** Never commit `perf` (private key) to git
3. **Firewall:** Current config is open for testing; restrict in production
4. **Cleanup:** Always destroy resources after testing to avoid charges

## Next Steps

After successful testing:
1. Document results in `/Users/nandi/test-plans/benchmark-results.json`
2. Post findings to GitHub issues #3033 and PR #3356
3. Destroy infrastructure: `terraform destroy`
4. Consider opening a PR to test-plans repo with Hetzner support
