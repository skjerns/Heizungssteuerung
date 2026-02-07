<?php

$target_host = '192.168.0.100:5665';

// Get the query string from the request
$query_string = $_SERVER['QUERY_STRING'] ?? '';

// Build the target URL - the query string becomes the path
$endpoint = '/' . $query_string;
$target_url = 'http://' . $target_host . $endpoint;

// Make the request using cURL
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $target_url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 30);
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);

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
