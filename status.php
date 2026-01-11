<?php
header('Content-Type: application/json');

$config = json_decode(file_get_contents('config.json'), true);

$roomTempFile = $config['room_temperature_csv'];
$eq3TempFile = $config['eq3_temperature_csv'];
$nLines = 2000; // Set desired number of history lines

function getLastLines($filename, $n) {
    if (!file_exists($filename)) return null;
    $data = file($filename);
    return array_map('trim', array_slice($data, -$n));
}

$room_history = getLastLines($roomTempFile, $nLines);
$eq3_history = getLastLines($eq3TempFile, $nLines);

$roomTemp = !empty($room_history) ? end($room_history) : null;
$eq3Temp = !empty($eq3_history) ? end($eq3_history) : null;

echo json_encode([
    'room_temp' => $roomTemp,
    'eq3_temp' => $eq3Temp,
    'room_hist' => $room_history,
    'eq3_hist' => $eq3_history
]);
