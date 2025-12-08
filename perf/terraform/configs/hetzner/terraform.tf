terraform {
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.45"
    }
  }
}

# Set your Hetzner API token as environment variable:
# export HCLOUD_TOKEN="your-hetzner-api-token"
provider "hcloud" {
  # Token is read from HCLOUD_TOKEN env var
}

# SSH key for accessing instances
resource "hcloud_ssh_key" "perf" {
  name       = "perf-key"
  public_key = file("${path.module}/../../modules/short_lived/files/perf.pub")
}

# Server instance (in Nuremberg, Germany)
resource "hcloud_server" "server" {
  name        = "perf-server"
  server_type = "cx22"  # 2 vCPU, 4GB RAM, ~€5/month
  image       = "ubuntu-22.04"
  location    = "nbg1"  # Nuremberg, Germany
  ssh_keys    = [hcloud_ssh_key.perf.id]

  # User data to install Node.js and Docker
  user_data = <<-EOF
    #cloud-config
    package_update: true
    package_upgrade: true
    packages:
      - curl
      - build-essential
      - git
      - docker.io
    runcmd:
      # Install Node.js 22
      - curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
      - apt-get install -y nodejs
      # Install pnpm globally
      - npm install -g pnpm
      # Setup ec2-user equivalent (ubuntu user already exists)
      - echo "Node.js version:" > /home/ubuntu/setup.log
      - node --version >> /home/ubuntu/setup.log
      - echo "pnpm version:" >> /home/ubuntu/setup.log
      - pnpm --version >> /home/ubuntu/setup.log
      - chown ubuntu:ubuntu /home/ubuntu/setup.log
  EOF

  labels = {
    project = "libp2p-perf"
    role    = "server"
  }
}

# Client instance (in Falkenstein, Germany - different datacenter for network testing)
resource "hcloud_server" "client" {
  name        = "perf-client"
  server_type = "cx22"  # 2 vCPU, 4GB RAM
  image       = "ubuntu-22.04"
  location    = "fsn1"  # Falkenstein, Germany
  ssh_keys    = [hcloud_ssh_key.perf.id]

  user_data = <<-EOF
    #cloud-config
    package_update: true
    package_upgrade: true
    packages:
      - curl
      - build-essential
      - git
      - docker.io
      - iperf3
    runcmd:
      # Install Node.js 22
      - curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
      - apt-get install -y nodejs
      # Install pnpm globally
      - npm install -g pnpm
      - echo "Node.js version:" > /home/ubuntu/setup.log
      - node --version >> /home/ubuntu/setup.log
      - echo "pnpm version:" >> /home/ubuntu/setup.log
      - pnpm --version >> /home/ubuntu/setup.log
      - chown ubuntu:ubuntu /home/ubuntu/setup.log
  EOF

  labels = {
    project = "libp2p-perf"
    role    = "client"
  }
}

# Firewall rule for server (allow all outbound, restrict inbound)
resource "hcloud_firewall" "perf_server" {
  name = "perf-server-firewall"

  # Allow SSH
  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "22"
    source_ips = [
      "0.0.0.0/0",
      "::/0"
    ]
  }

  # Allow perf test port (TCP)
  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "4001"
    source_ips = [
      "0.0.0.0/0",
      "::/0"
    ]
  }

  # Allow perf test port (UDP for WebRTC)
  rule {
    direction = "in"
    protocol  = "udp"
    port      = "4001"
    source_ips = [
      "0.0.0.0/0",
      "::/0"
    ]
  }

  # Allow iperf3
  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "5201"
    source_ips = [
      "0.0.0.0/0",
      "::/0"
    ]
  }

  # Allow ping
  rule {
    direction = "in"
    protocol  = "icmp"
    source_ips = [
      "0.0.0.0/0",
      "::/0"
    ]
  }
}

# Attach firewall to server
resource "hcloud_firewall_attachment" "perf_server" {
  firewall_id = hcloud_firewall.perf_server.id
  server_ids  = [hcloud_server.server.id]
}

# Output the public IPs
output "server_ip" {
  value       = hcloud_server.server.ipv4_address
  description = "Public IP address of the server"
}

output "client_ip" {
  value       = hcloud_server.client.ipv4_address
  description = "Public IP address of the client"
}

output "ssh_command_server" {
  value       = "ssh ubuntu@${hcloud_server.server.ipv4_address}"
  description = "SSH command for server"
}

output "ssh_command_client" {
  value       = "ssh ubuntu@${hcloud_server.client.ipv4_address}"
  description = "SSH command for client"
}
