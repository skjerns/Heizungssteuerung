<?php
header('Content-Type: application/json');

$config = json_decode(file_get_contents('config.json'), true);

// the page reads timestamps as local time; PHP often defaults to UTC
$tz = trim(@file_get_contents('/etc/timezone') ?: '');
if ($tz !== '') date_default_timezone_set($tz);

$gatewayHost = $config['trv_gateway_host'];
$trvId = (int) ($config['trv_id'] ?? 200);

// status of the TRV as cached by the BLU gateway
$ch = curl_init('http://' . $gatewayHost . '/rpc/BluTrv.GetStatus?id=' . $trvId);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 10);
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
$trv = json_decode(curl_exec($ch) ?: 'null', true);

// "Y-m-d H:i, value", stamped with the TRV's last report so the page can show staleness
function stamped($trv, $key) {
    if (!is_array($trv) || !isset($trv[$key])) return null;
    $ts = $trv['last_updated_ts'] ?? time();
    return date('Y-m-d H:i', $ts) . ', ' . $trv[$key];
}

// DS18B20 1-wire sensor attached to this Pi; "Y-m-d H:i, value" or null
function sensorTemp() {
    $files = glob('/sys/bus/w1/devices/28*/w1_slave');
    if (empty($files)) return null;
    // a read can fail its CRC check ("NO"), so retry a few times
    for ($i = 0; $i < 3; $i++) {
        $raw = @file_get_contents($files[0]);
        if ($raw !== false && strpos($raw, 'YES') !== false && preg_match('/t=(-?\d+)/', $raw, $m)) {
            return date('Y-m-d H:i') . ', ' . round($m[1] / 1000, 1);
        }
        usleep(200000);
    }
    return null;
}

echo json_encode([
    'room_temp' => stamped($trv, 'current_C'),
    'sensor_temp' => sensorTemp(),
    // key kept as eq3_temp for status.html
    'eq3_temp' => stamped($trv, 'target_C'),
]);
