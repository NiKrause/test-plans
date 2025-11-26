import { execSync } from 'child_process';
import { Version, versions } from './versions';
import yargs from 'yargs';
import fs from 'fs';
import { BenchmarkResults, Benchmark, Result, IperfResults, PingResults, ResultValue } from './benchmark-result-type';

async function main(clientPublicIP: string, serverPublicIP: string, testing: boolean, testFilter: string[]) {
    const iterations = testing ? 1 : 10;

    console.error(`= Starting benchmark with ${iterations} iterations on implementations ${testFilter}`);

    let pings: PingResults = { unit: "s", results: [] };
    let iperf: IperfResults = { unit: "bit/s", results: [] };
    
    try {
        pings = runPing(clientPublicIP, serverPublicIP, testing);
    } catch (error) {
        console.error('Warning: Ping test failed:', (error as Error).message);
    }
    
    try {
        iperf = runIPerf(clientPublicIP, serverPublicIP, testing);
    } catch (error) {
        console.error('Warning: iPerf test failed:', (error as Error).message);
    }

    const versionsToRun = versions.filter(version => testFilter.includes('all') || testFilter.includes(version.implementation))

    const implsToBuild = Array.from(new Set(versionsToRun.map(v => v.implementation))).join(' ');

    copyAndBuildPerfImplementations(serverPublicIP, implsToBuild);
    copyAndBuildPerfImplementations(clientPublicIP, implsToBuild);

    const benchmarks = [
        runBenchmarkAcrossVersions({
            name: "throughput/upload",
            clientPublicIP,
            serverPublicIP,
            uploadBytes: Number.MAX_SAFE_INTEGER,
            downloadBytes: 0,
            unit: "bit/s",
            iterations,
            durationSecondsPerIteration: testing ? 5 : 20,
        }, versionsToRun),
        runBenchmarkAcrossVersions({
            name: "throughput/download",
            clientPublicIP,
            serverPublicIP,
            uploadBytes: 0,
            downloadBytes: Number.MAX_SAFE_INTEGER,
            unit: "bit/s",
            iterations,
            durationSecondsPerIteration: testing ? 5 : 20,
        }, versionsToRun),
        runBenchmarkAcrossVersions({
            name: "Connection establishment + 1 byte round trip latencies",
            clientPublicIP,
            serverPublicIP,
            uploadBytes: 1,
            downloadBytes: 1,
            unit: "s",
            iterations: testing ? 1 : 100,
            durationSecondsPerIteration: Number.MAX_SAFE_INTEGER,
        }, versionsToRun),
    ];

    const benchmarkResults: BenchmarkResults = {
        benchmarks,
        pings,
        iperf,
    };

    // Save results to benchmark-results.json
    fs.writeFileSync('./benchmark-results.json', JSON.stringify(benchmarkResults, null, 2));

    console.error("== done");
}

function runPing(clientPublicIP: string, serverPublicIP: string, testing: boolean): PingResults {
    const pingCount = testing ? 1 : 100;
    console.error(`= run ${pingCount} pings from client to server`);

    const cmd = `ssh -o StrictHostKeyChecking=no root@${clientPublicIP} 'ping -c ${pingCount} ${serverPublicIP}'`;
    const stdout = execCommand(cmd).toString();

    // Extract the time from each ping
    const lines = stdout.split('\n');
    const times = lines
        .map(line => {
            const match = line.match(/time=(.*) ms/);
            return match ? parseFloat(match[1]) / 1000 : null; // Convert from ms to s
        })
        .filter((time): time is number => time !== null); // Remove any null values and ensure that array contains only numbers

    return { unit: "s", results: times }
}

function runIPerf(clientPublicIP: string, serverPublicIP: string, testing: boolean): IperfResults {
    const iPerfIterations = testing ? 1 : 60;
    console.error(`= run ${iPerfIterations} iPerf TCP from client to server`);

    const killCMD = `ssh -o StrictHostKeyChecking=no root@${serverPublicIP} 'kill $(cat pidfile); rm pidfile; rm server.log || true'`;
    const killSTDOUT = execCommand(killCMD);
    console.error(killSTDOUT);

    const serverCMD = `ssh -o StrictHostKeyChecking=no root@${serverPublicIP} 'nohup iperf3 -s > server.log 2>&1 & echo \$! > pidfile '`;
    const serverSTDOUT = execCommand(serverCMD);
    console.error(serverSTDOUT);

    const cmd = `ssh -o StrictHostKeyChecking=no root@${clientPublicIP} 'iperf3 -c ${serverPublicIP} -t ${iPerfIterations} -N'`;
    const stdout = execSync(cmd).toString();

    // Extract the bitrate from each relevant line
    const lines = stdout.split('\n');
    const bitrates = lines
        .map(line => {
            const match = line.match(/(\d+(?:\.\d+)?) (\w)bits\/sec/); // Matches and captures the number and unit before "bits/sec"
            if (match) {
                const value = parseFloat(match[1]);
                const unit = match[2];
                // Convert value to bits/sec
                const multiplier = unit === 'G' ? 1e9 : unit === 'M' ? 1e6 : unit === 'K' ? 1e3 : 1;
                return value * multiplier;
            }
            return null;
        })
        .filter((bitrate): bitrate is number => bitrate !== null); // Remove any null values

    return { unit: "bit/s", results: bitrates }
}

interface ArgsRunBenchmarkAcrossVersions {
    name: string,
    clientPublicIP: string;
    serverPublicIP: string;
    uploadBytes: number,
    downloadBytes: number,
    unit: "bit/s" | "s",
    iterations: number,
    durationSecondsPerIteration: number,
}

function runBenchmarkAcrossVersions(args: ArgsRunBenchmarkAcrossVersions, versionsToRun: Version[]): Benchmark {
    console.error(`= Benchmark ${args.name} on versions ${versionsToRun.map(v => v.implementation).join(', ')}`)

    const results: Result[] = [];

    for (const version of versionsToRun) {
        console.error(`== Version ${version.implementation}/${version.id}`)

        console.error(`=== Starting server ${version.implementation}/${version.id}`);

        const killCMD = `ssh -o StrictHostKeyChecking=no root@${args.serverPublicIP} 'kill $(cat pidfile); rm pidfile; rm server.log; rm /tmp/webrtc-listen-addrs.txt || true'`;
        const killSTDOUT = execCommand(killCMD);
        console.error(killSTDOUT);

        // For WebRTC Direct, we need to pass the transport to the server
        // Note: Current published @libp2p/webrtc binds to 127.0.0.1 when given a specific IP,
        // so we use 0.0.0.0 and replace 127.0.0.1 with the public IP when capturing the address
        const serverBindAddr = '0.0.0.0';
        const transportParam = version.transportStacks.includes('webrtc-direct') ? ' --transport webrtc-direct' : '';
        const serverCMD = `ssh -o StrictHostKeyChecking=no root@${args.serverPublicIP} 'nohup ./impl/${version.implementation}/${version.id}/perf --run-server --server-address ${serverBindAddr}:4001${transportParam} > server.log 2>&1 & echo \$! > pidfile '`;
        const serverSTDOUT = execCommand(serverCMD);
        console.error(serverSTDOUT);

        // Wait for server to be ready and capture listen address for WebRTC Direct
        let serverListenAddr: string | undefined;
        for (const transportStack of version.transportStacks) {
            if (transportStack === 'webrtc-direct') {
                // Give server time to start and print listen address
                console.error(`=== Waiting for WebRTC Direct server listen address...`);
                execCommand(`sleep 2`);
                serverListenAddr = getWebRTCDirectListenAddr(args.serverPublicIP);
                console.error(`=== Captured server listen address: ${serverListenAddr}`);
            }
        }

        for (const transportStack of version.transportStacks) {
            const result = runClient({
                clientPublicIP: args.clientPublicIP,
                serverPublicIP: args.serverPublicIP,
                serverListenAddr: serverListenAddr,
                id: version.id,
                implementation: version.implementation,
                transportStack: transportStack,
                uploadBytes: args.uploadBytes,
                downloadBytes: args.downloadBytes,
                iterations: args.iterations,
                durationSecondsPerIteration: args.durationSecondsPerIteration,
            });

            results.push({
                result,
                implementation: version.implementation,
                version: version.id,
                transportStack: transportStack,
            });
        }
    };

    return {
        name: args.name,
        unit: args.unit,
        results,
        parameters: {
            uploadBytes: args.uploadBytes,
            downloadBytes: args.downloadBytes,
        }
    };
}

interface ArgsRunBenchmark {
    clientPublicIP: string;
    serverPublicIP: string;
    serverListenAddr?: string;
    id: string,
    implementation: string,
    transportStack: string,
    uploadBytes: number,
    downloadBytes: number,
    iterations: number,
    durationSecondsPerIteration: number,
}

function runClient(args: ArgsRunBenchmark): ResultValue[] {
    console.error(`=== Starting client ${args.implementation}/${args.id}/${args.transportStack}`);

    // For WebRTC Direct, use the captured listen multiaddr; otherwise use host:port
    const serverAddress = args.transportStack === 'webrtc-direct' && args.serverListenAddr
        ? args.serverListenAddr
        : `${args.serverPublicIP}:4001`;

    const cmd = `./impl/${args.implementation}/${args.id}/perf --server-address ${serverAddress} --transport ${args.transportStack} --upload-bytes ${args.uploadBytes} --download-bytes ${args.downloadBytes}`
    // Note 124 is timeout's exit code when timeout is hit which is not a failure here.
    const withTimeout = `timeout ${args.durationSecondsPerIteration}s ${cmd} || [ $? -eq 124 ]`
    const withForLoop = `for i in {1..${args.iterations}}; do ${withTimeout}; done`
    const withSSH = `ssh -o StrictHostKeyChecking=no root@${args.clientPublicIP} '${withForLoop}'`

    const stdout = execCommand(withSSH);

    const lines = stdout.toString().trim().split('\n');

    const combined: ResultValue[] = [];

    for (const line of lines) {
        try {
            const result = JSON.parse(line) as ResultValue;
            combined.push(result);
        } catch (error) {
            console.error(`Could not parse ResultValue from line: ${line}`)
        }
    }

    return combined;
}

function execCommand(cmd: string): string {
    try {
        const stdout = execSync(cmd, {
            encoding: 'utf8',
            stdio: [process.stdin, 'pipe', process.stderr],
        });
        return stdout;
    } catch (error) {
        console.error((error as Error).message);
        process.exit(1);
    }
}

/**
 * Extracts the WebRTC Direct listen multiaddr from the /tmp/webrtc-listen-addrs.txt file.
 * The server prints lines like: [LISTEN_ADDR] /ip4/x.x.x.x/udp/4001/webrtc-direct/certhash/.../p2p/...
 * Note: Replaces 127.0.0.1 with the actual public IP since current @libp2p/webrtc binds to localhost.
 */
function getWebRTCDirectListenAddr(serverPublicIP: string): string {
    const cmd = `ssh -o StrictHostKeyChecking=no root@${serverPublicIP} 'cat /tmp/webrtc-listen-addrs.txt 2>/dev/null | grep "\[LISTEN_ADDR\]" | tail -1'`;
    const stdout = execCommand(cmd).trim();
    
    // Extract the multiaddr from the log line
    const match = stdout.match(/\[LISTEN_ADDR\]\s+(\/ip[46]\/[^\s]+)/);
    if (!match || !match[1]) {
        console.error(`Failed to extract listen address. Output: ${stdout}`);
        throw new Error('Could not find WebRTC Direct listen address in /tmp/webrtc-listen-addrs.txt');
    }
    
    // Replace 127.0.0.1 with the actual public IP
    const multiaddr = match[1].replace('/ip4/127.0.0.1/', `/ip4/${serverPublicIP}/`);
    return multiaddr;
}

function copyAndBuildPerfImplementations(ip: string, impls: string) {
    console.error(`= Building implementations for ${impls} on ${ip}`);

    const stdout = execCommand(`rsync -avz --progress --exclude='node_modules' --filter=':- .gitignore' -e "ssh -o StrictHostKeyChecking=no" ../impl root@${ip}:/root`);
    console.error(stdout.toString());

    const stdout2 = execCommand(`ssh -o StrictHostKeyChecking=no root@${ip} 'cd impl && make ${impls}'`);
    console.error(stdout2.toString());
}

const argv = yargs
    .options({
        'client-public-ip': {
            type: 'string',
            demandOption: true,
            description: 'Client public IP address',
        },
        'server-public-ip': {
            type: 'string',
            demandOption: true,
            description: 'Server public IP address',
        },
        'testing': {
            type: 'boolean',
            default: false,
            description: 'Run in testing mode',
            demandOption: false,
        },
        'test-filter': {
            type: 'string',
            array: true,
            choices: ['js-libp2p', 'rust-libp2p', 'go-libp2p', 'https', 'quic-go', 'all'],
            description: 'Filter tests to run, only the implementations here will be run. It defaults to all.',
            demandOption: false,
            default: 'all'
        }
    })
    .command('help', 'Print usage information', yargs.help)
    .parseSync();

main(argv['client-public-ip'] as string, argv['server-public-ip'] as string, argv['testing'] as boolean, argv['test-filter'] as string[]);
