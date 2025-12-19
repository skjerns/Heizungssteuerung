<?php

$config = json_decode(file_get_contents('config.json'), true);

$SECRET = $config['remote_secret'];
$SSH_KEY = $config['remote_ssh_key'];
$TARGET_USER = $config['remote_target_user'];
$TARGET_IP = $config['remote_target_ip'];

function send_signal($ip, $user, $key) {
    $cmd = sprintf(
        '/usr/bin/ssh -T -i %s ' .
        '-o StrictHostKeyChecking=no ' .
        '-o UserKnownHostsFile=/dev/null ' .
        '-o GlobalKnownHostsFile=/dev/null ' .
        '%s@%s 2>&1',
        escapeshellarg($key),
        escapeshellarg($user),
        escapeshellarg($ip)
    );

    exec($cmd, $output, $ret);
    $out = implode("\n", $output);

    if ($ret === 0) {
        return "Suspend signal sent. Output:\n" . $out;
    }

    return "Error. Code: $ret\nOutput:\n" . $out;
}

if (isset($_GET['sleep']) && $_GET['sleep'] === $SECRET) {
    echo send_signal($TARGET_IP, $TARGET_USER, $SSH_KEY);
    exit;
}

http_response_code(403);
echo "Unauthorized";
?>

