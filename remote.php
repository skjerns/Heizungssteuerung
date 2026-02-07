<?php

$target_host = '192.168.0.100:5665';

// Get the query string from the reques
$query_string = $_SERVER['QUERY_STRING'] ?? '';

// Build the target URL - the query string becomes the path
// e.g., ?shutdown becomes /shutdown
$endpoint = '/' . $query_string;
$target_url = 'http://' . $target_host . $endpoint;

// Make the request using cURL
$ch = curl_init($target_url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 30);

$response = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);

if (curl_errno($ch)) {
    http_response_code(500);
    echo "Error: " . curl_error($ch);
} else {
    http_response_code($http_code);
    echo $response;
}

curl_close($ch);
?>
