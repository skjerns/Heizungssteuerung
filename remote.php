<?php

$target_host = '192.168.0.100:5665';

// Get the query string from the request
$query_string = $_SERVER['QUERY_STRING'] ?? '';

// Build the target URL - the query string becomes the path
// e.g., ?shutdown becomes /shutdown
$endpoint = '/' . $query_string;
$target_url = 'http://' . $target_host . $endpoint;

// Debug output
echo "<h3>Remote Proxy Debug Info</h3>";
echo "<pre>";
echo "Target URL: " . htmlspecialchars($target_url) . "\n";
echo "Query String: " . htmlspecialchars($query_string) . "\n";
echo "Endpoint: " . htmlspecialchars($endpoint) . "\n";
echo "\n--- Making request ---\n\n";

// Make the request using cURL
$ch = curl_init($target_url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 30);
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
curl_setopt($ch, CURLOPT_VERBOSE, false);

$response = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curl_info = curl_getinfo($ch);
$curl_error = curl_error($ch);
$curl_errno = curl_errno($ch);

if ($curl_errno) {
    echo "CURL ERROR:\n";
    echo "Error Code: " . $curl_errno . "\n";
    echo "Error Message: " . htmlspecialchars($curl_error) . "\n";
    echo "\n";
} else {
    echo "HTTP Response Code: " . $http_code . "\n";
    echo "Content Type: " . ($curl_info['content_type'] ?? 'N/A') . "\n";
    echo "Total Time: " . ($curl_info['total_time'] ?? 'N/A') . "s\n";
    echo "\n";
}

echo "--- Response ---\n\n";

if ($curl_errno) {
    http_response_code(500);
    echo "Failed to connect to target server.\n";
    echo "Please verify:\n";
    echo "1. Target host is reachable (192.168.0.100:5665)\n";
    echo "2. Service is running on port 5665\n";
    echo "3. No firewall blocking the connection\n";
} else {
    http_response_code($http_code);
    echo htmlspecialchars($response);
}

echo "</pre>";

curl_close($ch);
?>
