<?php

// Enable all error reporting
error_reporting(E_ALL);
ini_set('display_errors', 1);

echo "<h3>Remote Proxy Debug Info</h3>";
echo "<pre>";

// Check if curl is available
if (!function_exists('curl_init')) {
    die("ERROR: CURL extension is not available in PHP!\n");
}
echo "✓ CURL extension is available\n\n";

$target_host = '192.168.0.100:5665';

// Get the query string from the request
$query_string = $_SERVER['QUERY_STRING'] ?? '';

// Build the target URL - the query string becomes the path
// e.g., ?shutdown becomes /shutdown
$endpoint = '/' . $query_string;
$target_url = 'http://' . $target_host . $endpoint;

echo "Request Details:\n";
echo "  Target URL: " . htmlspecialchars($target_url) . "\n";
echo "  Query String: " . htmlspecialchars($query_string) . "\n";
echo "  Endpoint: " . htmlspecialchars($endpoint) . "\n";
echo "\n--- Making request ---\n\n";

// Make the request using cURL
$ch = curl_init();
if ($ch === false) {
    die("ERROR: Failed to initialize CURL!\n");
}
echo "✓ CURL initialized\n";

curl_setopt($ch, CURLOPT_URL, $target_url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 30);
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);

echo "✓ CURL options set\n";
echo "✓ Executing request...\n\n";

$start_time = microtime(true);
$response = curl_exec($ch);
$end_time = microtime(true);
$elapsed = round(($end_time - $start_time) * 1000, 2);

echo "Request completed in {$elapsed}ms\n\n";

$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curl_info = curl_getinfo($ch);
$curl_error = curl_error($ch);
$curl_errno = curl_errno($ch);

echo "CURL Info:\n";
echo "  Error Number: " . $curl_errno . "\n";
if ($curl_errno) {
    echo "  Error Message: " . htmlspecialchars($curl_error) . "\n";
}
echo "  HTTP Code: " . $http_code . "\n";
echo "  Content Type: " . ($curl_info['content_type'] ?? 'N/A') . "\n";
echo "  Total Time: " . ($curl_info['total_time'] ?? 'N/A') . "s\n";
echo "  Connect Time: " . ($curl_info['connect_time'] ?? 'N/A') . "s\n";
echo "  Primary IP: " . ($curl_info['primary_ip'] ?? 'N/A') . "\n";
echo "  Primary Port: " . ($curl_info['primary_port'] ?? 'N/A') . "\n";

echo "\n--- Response ---\n\n";

if ($curl_errno) {
    http_response_code(500);
    echo "Failed to connect to target server.\n";
    echo "CURL Error #" . $curl_errno . ": " . htmlspecialchars($curl_error) . "\n\n";
    echo "Common CURL Error Codes:\n";
    echo "  6 = Couldn't resolve host\n";
    echo "  7 = Failed to connect to host\n";
    echo "  28 = Operation timeout\n";
    echo "\nPlease verify:\n";
    echo "1. Target host is reachable: 192.168.0.100:5665\n";
    echo "2. Service is running on port 5665\n";
    echo "3. No firewall blocking the connection\n";
    echo "4. Try from command line: curl -v http://192.168.0.100:5665/" . htmlspecialchars($query_string) . "\n";
} else {
    http_response_code($http_code);
    echo "Response Body:\n";
    if ($response === false) {
        echo "  (empty/false response)\n";
    } elseif (empty($response)) {
        echo "  (empty string)\n";
    } else {
        echo htmlspecialchars($response);
    }
}

echo "</pre>";

curl_close($ch);
?>
