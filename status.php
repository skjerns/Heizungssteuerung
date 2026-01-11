<?php
header('Content-Type: application/json');

$config = json_decode(file_get_contents('config.json'), true);

$roomTempFile = $config['room_temp_file'];
$eq3TempFile = $config['eq3_temp_file'];

function getLastLine($filename) {
    $data = file($filename);
    return trim(end($data));
}

$roomTemp = null;
if (file_exists($roomTempFile)) {
    $roomTemp = getLastLine($roomTempFile);
}

$eq3Temp = null;
if (file_exists($eq3TempFile)) {
    $eq3Temp = getLastLine($eq3TempFile);
}

echo json_encode([
    'room_temp' => $roomTemp,
    'eq3_temp' => $eq3Temp,
]);
?>