<?php

$target_host = '192.168.0.100:5665';
$shelly_host = '192.168.0.235';
$playback_bin = '/home/pi/rc433_brennenstuhl_comfort_mini/playback';
$recordings_dir = '/home/pi/rc433_brennenstuhl_comfort_mini';

$query_string = $_SERVER['QUERY_STRING'] ?? '';
$rc433 = $_GET['rc433'] ?? '';

if ($rc433 !== '') {
    $name = preg_replace('/[^a-zA-Z0-9_\-]/', '', $rc433);
    $recording = escapeshellarg($recordings_dir . '/' . $name);
    $cmd = "{$playback_bin} {$recording} 2 > /dev/null 2>&1 &";
    exec($cmd);
    http_response_code(200);
    echo "Ok";
    exit;
} elseif ($query_string === 'wol') {
    $config = json_decode(file_get_contents(__DIR__ . '/config.json'), true);
    $mac = $config['wol_mac'];
    $broadcast = $config['wol_broadcast'];
    $hw = '';
    foreach (explode(':', $mac) as $b) {
        $hw .= chr(hexdec($b));
    }
    $packet = str_repeat(chr(0xFF), 6) . str_repeat($hw, 16);
    $sock = socket_create(AF_INET, SOCK_DGRAM, SOL_UDP);
    socket_set_option($sock, SOL_SOCKET, SO_BROADCAST, 1);
    $sent = socket_sendto($sock, $packet, strlen($packet), 0, $broadcast, 9);
    socket_close($sock);
    if ($sent === false) {
        http_response_code(500);
        echo "Error";
    } else {
        http_response_code(200);
        echo "Ok";
    }
    exit;
} elseif ($query_string === 'light_on' || $query_string === 'light_off') {
    $on = ($query_string === 'light_on');
    $target_url = 'http://' . $shelly_host . '/rpc/Switch.Set';
    $payload = json_encode(['id' => 0, 'on' => $on]);

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $target_url);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
} else {
    $endpoint = '/' . $query_string;
    $target_url = 'http://' . $target_host . $endpoint;

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $target_url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
}

$response = curl_exec($ch);
$curl_errno = curl_errno($ch);

if ($curl_errno) {
    http_response_code(500);
    echo "Error";
} else {
    http_response_code(200);
    echo "Ok";
}

curl_close($ch);
?>