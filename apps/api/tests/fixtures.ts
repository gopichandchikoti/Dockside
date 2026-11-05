export const exposition = (n = 0) => `# HELP node_cpu_seconds_total Seconds the CPUs spent in each mode.
node_cpu_seconds_total{cpu="0",mode="idle"} ${100 + n * 8}
node_cpu_seconds_total{cpu="0",mode="user"} ${30 + n * 2}
node_memory_MemTotal_bytes 1000
node_memory_MemAvailable_bytes 400
node_boot_time_seconds 1700000000
node_network_receive_bytes_total{device="eth0"} ${1000 + n * 100}
node_network_transmit_bytes_total{device="eth0"} ${1000 + n * 200}
node_filesystem_size_bytes{device="/dev/sda",mountpoint="/",fstype="ext4"} 10000
node_filesystem_avail_bytes{device="/dev/sda",mountpoint="/",fstype="ext4"} 5000
node_load1 1.5
`;
